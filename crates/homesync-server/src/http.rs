//! HTTP surface: the embedded web app, media delivery and read-only APIs.

use crate::calibration::{self, RecordingUpload};
use crate::state::App;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use qrcode::QrCode;
use rust_embed::RustEmbed;
use serde::Serialize;
use std::sync::Arc;

/// The browser client, compiled into the binary so the coordinator ships as a
/// single executable (spec section 3.1).
#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../../web/src"]
struct WebAssets;

/// Builds the full HTTP router.
pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/info", get(info))
        .route("/api/v1/rooms", get(list_rooms).post(create_room))
        .route("/api/v1/rooms/{code}", get(room_info))
        .route("/api/v1/media/{id}", get(media_bytes))
        .route("/api/v1/media/{id}/manifest", get(media_item_manifest))
        .route("/api/v1/media/{id}/art", get(media_artwork))
        .route("/api/v1/calibration/chirp/{code}", get(calibration_chirp))
        .route("/api/v1/calibration/recording", post(calibration_recording))
        .route("/api/v1/diagnostics", get(diagnostics))
        .route("/api/v1/invite.svg", get(invite_qr))
        .route("/api/v1/library", get(library).post(library_edit))
        .route("/ws", get(crate::ws::ws_handler))
        .fallback(static_asset)
        .with_state(app)
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

/// Version and capability advertisement.
#[derive(Debug, Serialize)]
struct Info {
    server_version: &'static str,
    protocol_version: u32,
    /// Coordinator monotonic nanoseconds, so a client can sanity-check the
    /// clock domain before opening a socket.
    server_ns: u64,
    start_lead_ms: f64,
    max_clients: usize,
    /// Source modes this build actually implements. Modes described in the
    /// specification but not yet built are absent rather than advertised.
    modes: Vec<&'static str>,
}

async fn info(State(app): State<Arc<App>>) -> impl IntoResponse {
    Json(Info {
        server_version: app.version,
        protocol_version: homesync_protocol::PROTOCOL_VERSION,
        server_ns: app.now_ns(),
        start_lead_ms: app.config.start_lead_ms,
        max_clients: app.config.max_clients,
        modes: vec!["controlled_audio", "youtube", "system_audio"],
    })
}

/// Public room metadata. Deliberately excludes the room secret: knowing a room
/// exists must not be enough to join it.
#[derive(Debug, Serialize)]
struct RoomInfo {
    room_code: String,
    clients: usize,
    max_clients: usize,
}

async fn room_info(State(app): State<Arc<App>>, Path(code): Path<String>) -> Response {
    let rooms = app.rooms();
    match rooms.get(&code.to_uppercase()) {
        Some(room) => Json(RoomInfo {
            room_code: room.code.clone(),
            clients: room.clients.len(),
            max_clients: app.config.max_clients,
        })
        .into_response(),
        None => (StatusCode::NOT_FOUND, "no such room").into_response(),
    }
}

/// One room, as listed to somebody who already holds a room secret.
#[derive(Debug, Serialize)]
struct RoomSummary {
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    clients: usize,
    playing: bool,
    /// True for the room the banner printed, which is never reaped.
    is_default: bool,
}

/// What creating a room hands back: enough to invite somebody into it.
#[derive(Debug, Serialize)]
struct CreatedRoom {
    code: String,
    secret: String,
    invite: String,
}

#[derive(Debug, serde::Deserialize)]
struct CreateRoom {
    /// A secret for any existing room. Creating rooms is for people already in
    /// the house, not for anyone who can reach the port.
    secret: String,
    #[serde(default)]
    name: Option<String>,
    /// The address the caller reached this coordinator on, so the invitation
    /// points somewhere the other devices can actually open. The coordinator
    /// cannot work this out for itself on a machine with several interfaces.
    #[serde(default)]
    origin: String,
}

/// Query carrying nothing but a room secret.
#[derive(Debug, serde::Deserialize)]
struct RoomsQuery {
    secret: String,
}

/// Lists the rooms this coordinator is running.
///
/// Gated on holding *a* room secret, and deliberately carries no secrets back:
/// knowing that a room exists is not permission to join it.
async fn list_rooms(State(app): State<Arc<App>>, Query(query): Query<RoomsQuery>) -> Response {
    if !authorised(&app, &query.secret) {
        return (StatusCode::FORBIDDEN, "a room secret is required to list rooms").into_response();
    }
    let default = app.default_room_code();
    let rooms = app.rooms();
    let mut summaries: Vec<RoomSummary> = rooms
        .values()
        .map(|room| RoomSummary {
            code: room.code.clone(),
            name: room.name.clone(),
            clients: room.clients.len(),
            playing: room.transport.state == homesync_protocol::TransportState::Playing,
            is_default: room.code == default,
        })
        .collect();
    // Default first, then by code, so the list does not reshuffle between polls
    // the way a HashMap's order would.
    summaries.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.code.cmp(&b.code)));
    Json(summaries).into_response()
}

/// Creates a room and returns its invitation.
///
/// A second room is what lets the kitchen play one thing while the bedroom
/// plays another: rooms share this coordinator, its clock service and its
/// library, and share nothing else — separate timelines, separate devices,
/// separate secrets.
async fn create_room(State(app): State<Arc<App>>, Json(request): Json<CreateRoom>) -> Response {
    if !authorised(&app, &request.secret) {
        return (StatusCode::FORBIDDEN, "a room secret is required to create a room").into_response();
    }
    // Validated before the room exists. Creating one and then failing to
    // describe how to reach it would leave a room nobody can be invited into —
    // and, because it is not the default room, one that is silently reaped half
    // an hour later.
    let origin = match usable_origin(&request.origin) {
        Ok(origin) => origin.to_string(),
        // The shared message is written for the QR code. A room is a different
        // thing to fail at, and being told the code will not scan does not
        // explain why the room was not made.
        Err(_) if request.origin.contains("//localhost") || request.origin.contains("//127.") => {
            return (
                StatusCode::CONFLICT,
                "this page is open on a loopback address, so an invitation minted here \
                 would point at a room no other device can reach. Open the coordinator by \
                 its LAN address and create the room from there.",
            )
                .into_response()
        }
        Err(reason) => return (StatusCode::CONFLICT, reason).into_response(),
    };
    let name = request.name.map(|name| name.trim().chars().take(40).collect::<String>()).filter(|n| !n.is_empty());
    let (code, secret) = app.create_room(name);

    let invite = invite_url(&origin, &code, &secret);
    let mut response = Json(CreatedRoom { code, secret, invite }).into_response();
    // Carries a secret, so it must not be cached anywhere shared.
    insert(&mut response, header::CACHE_CONTROL, "no-store".to_string());
    response
}

async fn media_item_manifest(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    match app.media_item(&id) {
        Some(item) => Json(item.clone()).into_response(),
        None => (StatusCode::NOT_FOUND, "no such media").into_response(),
    }
}

/// Serves media bytes with single-range support.
///
/// Receivers normally fetch the whole file and decode it, but range support
/// costs little and lets a receiver resume a partial download over flaky
/// Wi-Fi instead of restarting it.
/// Serves a track's embedded cover picture.
async fn media_artwork(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    let Some((content_type, bytes)) = app.media_artwork(&id) else {
        return (StatusCode::NOT_FOUND, "no artwork for that track").into_response();
    };
    let mut response = Body::from(bytes).into_response();
    insert(&mut response, header::CONTENT_TYPE, content_type);
    // The id is a content hash, so this picture can never change under a
    // client that already has it.
    insert(&mut response, header::CACHE_CONTROL, "public, max-age=86400, immutable".to_string());
    response
}

async fn media_bytes(State(app): State<Arc<App>>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let Some(item) = app.media_item(&id) else {
        return (StatusCode::NOT_FOUND, "no such media").into_response();
    };
    let Some(source) = app.media_source(&id) else {
        return (StatusCode::NOT_FOUND, "no such media").into_response();
    };

    // Measured now rather than taken from the catalogue: a file replaced since
    // the scan would otherwise have ranges computed against a length it no
    // longer has.
    let total = match source_len(&source).await {
        Ok(total) => total,
        Err(error) => {
            tracing::error!(%id, %error, "failed to measure media");
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to read media").into_response();
        }
    };

    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    let (status, start, len, content_range) = match homesync_media::parse_range(range_header, total) {
        Some(Err(())) => {
            let mut response = (StatusCode::RANGE_NOT_SATISFIABLE, "range not satisfiable").into_response();
            insert(&mut response, header::CONTENT_RANGE, format!("bytes */{total}"));
            return response;
        }
        Some(Ok(range)) => (
            StatusCode::PARTIAL_CONTENT,
            range.start,
            range.len(),
            Some(format!("bytes {}-{}/{}", range.start, range.end, total)),
        ),
        None => (StatusCode::OK, 0, total, None),
    };

    let body = match media_body(source, start, len).await {
        Ok(body) => body,
        Err(error) => {
            tracing::error!(%id, %error, "failed to read media");
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to read media").into_response();
        }
    };

    let mut response = (status, body).into_response();
    insert(&mut response, header::CONTENT_LENGTH, len.to_string());
    if let Some(content_range) = content_range {
        insert(&mut response, header::CONTENT_RANGE, content_range);
    }

    insert(&mut response, header::CONTENT_TYPE, item.content_type.clone());
    insert(&mut response, header::ACCEPT_RANGES, "bytes".to_string());
    // The id is a content hash, so the bytes behind a URL never change.
    insert(&mut response, header::ETAG, format!("\"{}\"", item.sha256));
    insert(&mut response, header::CACHE_CONTROL, "public, max-age=31536000, immutable".to_string());
    response
}

/// How much of a track is in memory at once while it is being served.
const MEDIA_CHUNK_BYTES: usize = 64 * 1024;

/// Current length of an item's bytes.
async fn source_len(source: &homesync_media::ItemSource) -> std::io::Result<u64> {
    match source {
        homesync_media::ItemSource::Memory(bytes) => Ok(bytes.len() as u64),
        homesync_media::ItemSource::File(path) => Ok(tokio::fs::metadata(path).await?.len()),
    }
}

/// A body carrying `len` bytes of `source` starting at `start`.
///
/// A file is seeked to and streamed in fixed-size chunks rather than read into
/// memory. That is what keeps a 40 MB track from costing 40 MB of coordinator
/// memory per listener — the endpoint holds one chunk at a time, whatever the
/// size of the file or the number of devices pulling it at once.
async fn media_body(source: homesync_media::ItemSource, start: u64, len: u64) -> std::io::Result<Body> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    match source {
        // Already in memory and shared, so slicing it is the whole job. Only
        // the synthesised click track takes this path.
        homesync_media::ItemSource::Memory(bytes) => {
            let from = (start as usize).min(bytes.len());
            let to = from.saturating_add(len as usize).min(bytes.len());
            Ok(Body::from(bytes[from..to].to_vec()))
        }
        homesync_media::ItemSource::File(path) => {
            let mut file = tokio::fs::File::open(&path).await?;
            if start > 0 {
                file.seek(std::io::SeekFrom::Start(start)).await?;
            }
            // `take` bounds the stream to the range even if the file grew
            // between the length measurement and this read.
            let stream = tokio_util::io::ReaderStream::with_capacity(file.take(len), MEDIA_CHUNK_BYTES);
            Ok(Body::from_stream(stream))
        }
    }
}

fn insert(response: &mut Response, name: header::HeaderName, value: String) {
    if let Ok(value) = HeaderValue::from_str(&value) {
        response.headers_mut().insert(name, value);
    }
}

/// Everything known about the coordinator and its rooms, in one document.
///
/// Exists so a problem found during testing arrives as data rather than as a
/// description of a sound. It carries the room snapshot, every client's clock
/// and telemetry, the live stream parameters, and the last calibration's
/// measurements — not merely the compensation those measurements produced.
#[derive(Debug, Serialize)]
struct Diagnostics {
    server_version: &'static str,
    protocol_version: u32,
    /// Coordinator monotonic nanoseconds, which is also its uptime.
    server_ns: u64,
    config: DiagnosticsConfig,
    rooms: Vec<DiagnosticsRoom>,
    /// Devices with saved compensation, including ones not currently present.
    saved_devices: usize,
}

#[derive(Debug, Serialize)]
struct DiagnosticsConfig {
    start_lead_ms: f64,
    max_clients: usize,
    media_items: usize,
    state_file: Option<String>,
}

#[derive(Debug, Serialize)]
struct DiagnosticsRoom {
    snapshot: homesync_protocol::RoomSnapshot,
    /// The most recent finished calibration run, if there was one.
    last_calibration: Option<homesync_protocol::CalibrationResult>,
}

#[derive(Debug, serde::Deserialize)]
struct DiagnosticsQuery {
    /// The room secret. Diagnostics carry device names and telemetry, so they
    /// are not readable by anything that merely reached the port.
    secret: String,
}

async fn diagnostics(State(app): State<Arc<App>>, Query(query): Query<DiagnosticsQuery>) -> Response {
    let manifest = app.media_manifest();
    let now = app.now_ns();
    let rooms = app.rooms();

    // Any room whose secret matches. In practice there is one.
    let authorised: Vec<DiagnosticsRoom> = rooms
        .values()
        .filter(|room| room.secret == query.secret)
        .map(|room| DiagnosticsRoom {
            snapshot: room.snapshot(manifest.clone(), now),
            last_calibration: room.last_calibration.clone(),
        })
        .collect();

    if authorised.is_empty() {
        return (StatusCode::FORBIDDEN, "the room secret is required to read diagnostics").into_response();
    }

    let report = Diagnostics {
        server_version: app.version,
        protocol_version: homesync_protocol::PROTOCOL_VERSION,
        server_ns: app.now_ns(),
        config: DiagnosticsConfig {
            start_lead_ms: app.config.start_lead_ms,
            max_clients: app.config.max_clients,
            media_items: manifest.items.len(),
            state_file: app.config.state_path().map(|p| p.display().to_string()),
        },
        rooms: authorised,
        saved_devices: app.profiles.len(),
    };

    let mut response = Json(report).into_response();
    // Named so a file saved from a browser is obviously a HomeSync report.
    insert(
        &mut response,
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"homesync-diagnostics.json\"".to_string(),
    );
    response
}

/// Serves a calibration chirp as a WAV file.
///
/// Rendered on demand rather than kept in the media catalogue: chirps are
/// measurement signals, not something anyone should be able to select and
/// play to a room.
async fn calibration_chirp(Path(code): Path<u32>) -> Response {
    // Any code is renderable, but a bound stops a client from asking for an
    // arbitrarily high one and getting a chirp outside the audible band.
    if code > 64 {
        return (StatusCode::NOT_FOUND, "no such chirp").into_response();
    }
    let spec = homesync_dsp::ChirpSpec::for_code(code, calibration::CHIRP_RATE);
    let wav = homesync_audio::wav::write_f32_as_s16(&spec.render(), calibration::CHIRP_RATE, 1);

    let mut response = Body::from(wav).into_response();
    insert(&mut response, header::CONTENT_TYPE, "audio/wav".to_string());
    insert(&mut response, header::CACHE_CONTROL, "public, max-age=3600".to_string());
    response
}

/// Query parameters accompanying an uploaded calibration recording.
#[derive(Debug, serde::Deserialize)]
struct RecordingQuery {
    session: String,
    target: String,
    repetition: u32,
    rate: u32,
    /// Coordinator time of the first recorded sample, as the microphone
    /// device estimates it.
    first_sample_server_ns: u64,
}

/// Largest calibration recording accepted: about 30 seconds of 48 kHz mono
/// float. Recordings are around a second, so anything near this is a mistake
/// or an attack.
const MAX_RECORDING_BYTES: usize = 48_000 * 4 * 30;

/// Receives a recorded window from the microphone device.
///
/// The body is raw little-endian `f32` mono samples. This goes over HTTP
/// rather than the control socket so a megabyte of audio cannot delay a clock
/// exchange queued behind it.
async fn calibration_recording(
    State(app): State<Arc<App>>,
    Query(query): Query<RecordingQuery>,
    body: Bytes,
) -> Response {
    if body.len() > MAX_RECORDING_BYTES {
        return (StatusCode::PAYLOAD_TOO_LARGE, "recording is too long").into_response();
    }
    if !app.calibration.is_active(&query.session) {
        return (StatusCode::NOT_FOUND, "no such calibration session").into_response();
    }
    if query.rate == 0 {
        return (StatusCode::BAD_REQUEST, "sample rate must be positive").into_response();
    }

    let samples: Vec<f32> = body
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        // A NaN or infinity would poison the correlation for the whole run.
        .map(|sample| if sample.is_finite() { sample } else { 0.0 })
        .collect();

    let delivered = app.calibration.deliver(RecordingUpload {
        session_id: query.session,
        target_client_id: query.target,
        repetition: query.repetition,
        sample_rate: query.rate,
        first_sample_server_ns: query.first_sample_server_ns,
        samples,
    });
    if delivered {
        (StatusCode::ACCEPTED, "accepted").into_response()
    } else {
        (StatusCode::NOT_FOUND, "no such calibration session").into_response()
    }
}

#[derive(Debug, serde::Deserialize)]
struct InviteQuery {
    /// The room secret. Whoever can already read it is already in the room, so
    /// this only stops a passer-by on the LAN from minting an invite.
    secret: String,
    /// Where the scanning device should be sent. Supplied by the client rather
    /// than assumed by the coordinator: the page asking for this code reached
    /// the coordinator at some address, and an address already proven to work
    /// beats one the host merely believes in.
    origin: String,
}

/// Renders the room invitation as a QR code.
///
/// Server-side because encoding a QR in the browser would mean either a
/// JavaScript library — and therefore a build step the single-binary deploy
/// does not have — or several hundred lines of encoder to maintain. The
/// coordinator already draws one for the terminal at startup.
async fn invite_qr(State(app): State<Arc<App>>, Query(query): Query<InviteQuery>) -> Response {
    let origin = match usable_origin(&query.origin) {
        Ok(origin) => origin,
        Err(reason) => return (StatusCode::CONFLICT, reason).into_response(),
    };

    let invite = {
        let rooms = app.rooms();
        let Some(room) = rooms.values().find(|room| room.secret == query.secret) else {
            return (StatusCode::FORBIDDEN, "the room secret is required to mint an invitation").into_response();
        };
        invite_url(origin, &room.code, &room.secret)
    };

    let Ok(code) = QrCode::new(invite.as_bytes()) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "could not encode the invitation").into_response();
    };

    let mut response = qr_svg(&code).into_response();
    insert(&mut response, header::CONTENT_TYPE, "image/svg+xml".to_string());
    // Carries the room secret, so it must not be cached anywhere shared.
    insert(&mut response, header::CACHE_CONTROL, "no-store, private".to_string());
    response
}

/// The invitation a scanning device follows.
///
/// The secret sits in the fragment, which browsers never put on the wire, so
/// the coordinator never sees it in a request path or an access log.
fn invite_url(origin: &str, code: &str, secret: &str) -> String {
    format!("{origin}/#room={code}&secret={secret}")
}

/// Checks an origin is worth putting in front of a camera.
///
/// A loopback address is the interesting rejection: the page works perfectly
/// for whoever is sitting at the host, and a QR code of it would scan cleanly
/// on a phone and then fail to connect to anything. Saying so is far better
/// than handing over a code that cannot work.
fn usable_origin(origin: &str) -> Result<&str, &'static str> {
    let origin = origin.trim_end_matches('/');
    if origin.len() > 128 || origin.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("that origin is not a usable address");
    }
    let host = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .ok_or("an invitation needs an http or https address")?;
    // A bracketed IPv6 literal keeps its colons, so it cannot be split on ':'
    // like a name or a v4 address can.
    let host = if let Some(rest) = host.strip_prefix('[') {
        match rest.split_once(']') {
            Some((inner, _)) => inner,
            None => return Err("that origin has an unterminated IPv6 address"),
        }
    } else {
        host.split([':', '/']).next().unwrap_or_default()
    };
    if host.is_empty() {
        return Err("that origin has no host");
    }
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host == "::1"
        || host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback());
    if loopback {
        return Err("this page is open on a loopback address, which no other device can reach — open it by the coordinator\u{2019}s LAN address and the code will be scannable");
    }
    Ok(origin)
}

/// Draws a QR code as an SVG, one path segment per dark module.
///
/// Always black on white regardless of the page theme: a scanner needs the
/// contrast, and a transparent code on a dark background is unreadable.
fn qr_svg(code: &QrCode) -> String {
    const QUIET: usize = 4;
    let width = code.width();
    let size = width + QUIET * 2;

    let mut modules = String::new();
    for (index, colour) in code.to_colors().iter().enumerate() {
        if *colour == qrcode::Color::Dark {
            let x = index % width + QUIET;
            let y = index / width + QUIET;
            modules.push_str(&format!("M{x} {y}h1v1h-1z"));
        }
    }

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {size} {size}\" \
         shape-rendering=\"crispEdges\" role=\"img\" aria-label=\"HomeSync invitation\">\
         <rect width=\"{size}\" height=\"{size}\" fill=\"#ffffff\"/>\
         <path d=\"{modules}\" fill=\"#000000\"/></svg>"
    )
}

#[derive(Debug, serde::Deserialize)]
struct LibraryQuery {
    /// The room secret. The catalogue names files on the host's disk, and
    /// editing the roots reads whatever directory it is given, so this is not
    /// something a passer-by on the LAN gets to do.
    secret: String,
}

#[derive(Debug, serde::Deserialize)]
struct LibraryEdit {
    secret: String,
    /// Folder to start scanning. A mounted drive is just a path.
    #[serde(default)]
    add: Option<String>,
    /// Folder to stop scanning.
    #[serde(default)]
    remove: Option<String>,
    /// URL of an audio file to pull into the library.
    #[serde(default)]
    fetch: Option<String>,
}

#[derive(Debug, Serialize)]
struct LibraryView {
    roots: Vec<String>,
    items: usize,
    /// Set when an edit was asked for and refused, so the interface can say why
    /// rather than showing an unchanged list and no explanation.
    #[serde(skip_serializing_if = "Option::is_none")]
    problem: Option<String>,
}

fn authorised(app: &App, secret: &str) -> bool {
    app.rooms().values().any(|room| room.secret == secret)
}

fn library_view(app: &App, problem: Option<String>) -> Response {
    Json(LibraryView {
        roots: app.media_roots().iter().map(|r| r.display().to_string()).collect(),
        items: app.media_manifest().items.len(),
        problem,
    })
    .into_response()
}

/// Lists the folders being scanned, and rescans them.
///
/// A GET rescans deliberately: a drive plugged in after startup is the ordinary
/// case, and the alternative — restarting the coordinator — drops every device
/// out of the room and loses everyone's clock.
async fn library(State(app): State<Arc<App>>, Query(query): Query<LibraryQuery>) -> Response {
    if !authorised(&app, &query.secret) {
        return (StatusCode::FORBIDDEN, "the room secret is required to read the library").into_response();
    }
    let items = app.rescan_media();
    tracing::info!(items, "library rescanned");
    library_view(&app, None)
}

/// Adds or removes a folder, then rebuilds.
async fn library_edit(State(app): State<Arc<App>>, Json(edit): Json<LibraryEdit>) -> Response {
    if !authorised(&app, &edit.secret) {
        return (StatusCode::FORBIDDEN, "the room secret is required to change the library").into_response();
    }
    let mut problem = None;
    if let Some(add) = edit.add.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        if !app.add_media_root(std::path::PathBuf::from(add)) {
            problem = Some(format!("{add} is not a folder this machine can read"));
        }
    }
    if let Some(remove) = edit.remove.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        app.remove_media_root(std::path::Path::new(remove));
    }
    if let Some(url) = edit.fetch.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        let dir = app.config.download_dir.clone();
        match app.fetch_media(url, &dir).await {
            Ok(name) => tracing::info!(%url, file = %name, "fetched a track into the library"),
            Err(reason) => problem = Some(format!("could not fetch that URL — {reason}")),
        }
    }
    library_view(&app, problem)
}

/// Serves the embedded web app. Unknown paths fall back to `index.html` so the
/// invite URL can carry a path without a server-side route for it.
async fn static_asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    let asset = WebAssets::get(path).or_else(|| WebAssets::get("index.html"));
    let Some(asset) = asset else {
        return (StatusCode::NOT_FOUND, "web assets are missing from this build").into_response();
    };

    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Body::from(asset.data.to_vec()).into_response();
    insert(&mut response, header::CONTENT_TYPE, mime.to_string());
    // The app is served from a LAN host that is frequently rebuilt during
    // development; a stale cached client is far more confusing than a refetch.
    insert(&mut response, header::CACHE_CONTROL, "no-cache".to_string());
    response
}

/// Reports whether the web client was embedded, so startup can warn loudly
/// rather than serving a blank page.
pub fn web_assets_present() -> bool {
    WebAssets::get("index.html").is_some()
}

/// Number of embedded web assets, for the startup log.
pub fn web_asset_count() -> usize {
    WebAssets::iter().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_secret_stays_in_the_fragment() {
        let url = invite_url("http://192.168.1.5:8080", "AA12345", "s3cret");
        assert_eq!(url, "http://192.168.1.5:8080/#room=AA12345&secret=s3cret");
        // Everything before the '#' is what a browser sends and a proxy logs.
        let (sent, _) = url.split_once('#').expect("the invitation needs a fragment");
        assert!(!sent.contains("s3cret"), "the secret must not be in the request path: {sent}");
    }

    #[test]
    fn loopback_origins_are_refused_with_a_reason() {
        // These scan perfectly and then connect to nothing, which is a worse
        // failure than refusing to draw the code.
        for origin in ["http://localhost:8080", "http://127.0.0.1:8080", "https://[::1]:8080"] {
            let error = usable_origin(origin).expect_err(origin);
            assert!(error.contains("loopback"), "{origin}: {error}");
        }
    }

    #[test]
    fn lan_origins_are_accepted_and_normalised() {
        assert_eq!(usable_origin("http://192.168.1.5:8080"), Ok("http://192.168.1.5:8080"));
        assert_eq!(usable_origin("https://homesync.local:8080/"), Ok("https://homesync.local:8080"));
    }

    #[test]
    fn nonsense_origins_are_refused() {
        assert!(usable_origin("ftp://192.168.1.5").is_err());
        assert!(usable_origin("192.168.1.5:8080").is_err(), "a scheme is required");
        assert!(usable_origin("http://").is_err());
        assert!(usable_origin("http://host with spaces").is_err());
        assert!(usable_origin(&format!("http://{}", "x".repeat(200))).is_err());
    }

    #[test]
    fn the_svg_is_square_and_has_a_quiet_zone() {
        let code = QrCode::new(b"http://192.168.1.5:8080/#room=AA12345&secret=s3cret").expect("encode");
        let svg = qr_svg(&code);
        let side = code.width() + 8;
        assert!(svg.contains(&format!("viewBox=\"0 0 {side} {side}\"")), "{svg:.120}");
        // A light background is not decoration: a transparent code on a dark
        // page cannot be scanned.
        assert!(svg.contains("fill=\"#ffffff\""));
        assert!(svg.starts_with("<svg") && svg.ends_with("</svg>"));
    }
}

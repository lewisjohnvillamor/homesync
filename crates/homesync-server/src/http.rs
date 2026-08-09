//! HTTP surface: the embedded web app, media delivery and read-only APIs.

use crate::calibration::{self, RecordingUpload};
use crate::media;
use crate::state::App;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
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
        .route("/api/v1/rooms/{code}", get(room_info))
        .route("/api/v1/media/{id}", get(media_bytes))
        .route("/api/v1/media/{id}/manifest", get(media_item_manifest))
        .route("/api/v1/calibration/chirp/{code}", get(calibration_chirp))
        .route("/api/v1/calibration/recording", post(calibration_recording))
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

async fn media_item_manifest(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    match app.media.item(&id) {
        Some(item) => Json(item.clone()).into_response(),
        None => (StatusCode::NOT_FOUND, "no such media").into_response(),
    }
}

/// Serves media bytes with single-range support.
///
/// Receivers normally fetch the whole file and decode it, but range support
/// costs little and lets a receiver resume a partial download over flaky
/// Wi-Fi instead of restarting it.
async fn media_bytes(State(app): State<Arc<App>>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let Some(item) = app.media.item(&id).cloned() else {
        return (StatusCode::NOT_FOUND, "no such media").into_response();
    };
    let bytes = match app.media.read(&id) {
        Some(Ok(bytes)) => bytes,
        Some(Err(error)) => {
            tracing::error!(%id, %error, "failed to read media");
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to read media").into_response();
        }
        None => return (StatusCode::NOT_FOUND, "no such media").into_response(),
    };

    let total = bytes.len() as u64;
    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    let mut response = match media::parse_range(range_header, total) {
        Some(Err(())) => {
            let mut response = (StatusCode::RANGE_NOT_SATISFIABLE, "range not satisfiable").into_response();
            insert(&mut response, header::CONTENT_RANGE, format!("bytes */{total}"));
            return response;
        }
        Some(Ok(range)) => {
            let slice = bytes[range.start as usize..=range.end as usize].to_vec();
            let mut response = (StatusCode::PARTIAL_CONTENT, Body::from(slice)).into_response();
            insert(&mut response, header::CONTENT_RANGE, format!("bytes {}-{}/{}", range.start, range.end, total));
            insert(&mut response, header::CONTENT_LENGTH, range.len().to_string());
            response
        }
        None => {
            let mut response = Body::from(bytes).into_response();
            insert(&mut response, header::CONTENT_LENGTH, total.to_string());
            response
        }
    };

    insert(&mut response, header::CONTENT_TYPE, item.content_type.clone());
    insert(&mut response, header::ACCEPT_RANGES, "bytes".to_string());
    // The id is a content hash, so the bytes behind a URL never change.
    insert(&mut response, header::ETAG, format!("\"{}\"", item.sha256));
    insert(&mut response, header::CACHE_CONTROL, "public, max-age=31536000, immutable".to_string());
    response
}

fn insert(response: &mut Response, name: header::HeaderName, value: String) {
    if let Ok(value) = HeaderValue::from_str(&value) {
        response.headers_mut().insert(name, value);
    }
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

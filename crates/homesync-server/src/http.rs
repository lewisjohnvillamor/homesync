//! HTTP surface: the embedded web app, media delivery and read-only APIs.

use crate::media;
use crate::state::App;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
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
        modes: vec!["controlled_audio"],
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

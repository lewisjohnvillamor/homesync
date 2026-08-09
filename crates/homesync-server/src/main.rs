//! HomeSync coordinator entry point.

mod clock;
mod config;
mod http;
mod media;
mod room;
mod simulate;
mod state;
mod ws;

use clap::Parser;
use config::Config;
use media::MediaLibrary;
use qrcode::render::unicode;
use qrcode::QrCode;
use room::Room;
use state::App;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use ulid::Ulid;

/// How often coalesced room snapshots are flushed to clients.
const SNAPSHOT_FLUSH_INTERVAL: Duration = Duration::from_millis(500);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,homesync_server=info")),
        )
        .with_target(false)
        .init();

    let config = Config::parse();

    if !http::web_assets_present() {
        tracing::error!("the web client was not embedded in this build; check that web/src/index.html exists");
    }

    let media = MediaLibrary::load(&config.media_dir);
    let room_code = config.room_code.clone().unwrap_or_else(random_room_code);
    let room_secret = config.room_secret.clone().unwrap_or_else(|| Ulid::new().to_string());
    let room = Room::new(room_code.clone(), room_secret.clone(), config.start_lead_ns(), config.max_clients);

    let addr = SocketAddr::new(config.bind, config.port);
    let app = Arc::new(App::new(config, media, room));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;

    print_banner(&app, &room_code, &room_secret, bound);

    // Coalesced telemetry snapshots.
    let flusher = {
        let app = Arc::clone(&app);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(SNAPSHOT_FLUSH_INTERVAL);
            loop {
                ticker.tick().await;
                ws::flush_dirty_rooms(&app);
            }
        })
    };

    let simulation = if app.config.simulate > 0 {
        let app = Arc::clone(&app);
        let url = format!("ws://127.0.0.1:{}/ws", bound.port());
        let code = room_code.clone();
        let secret = room_secret.clone();
        Some(tokio::spawn(async move {
            simulate::run(&url, &code, &secret, app.config.simulate, app.config.simulate_seconds).await
        }))
    } else {
        None
    };

    let server = axum::serve(listener, http::router(Arc::clone(&app)).into_make_service())
        .with_graceful_shutdown(shutdown_signal());

    if let Some(simulation) = simulation {
        let exit_after = app.config.simulate_then_exit;
        tokio::select! {
            result = server => result?,
            outcome = simulation => {
                let passed = outcome.unwrap_or(false);
                if exit_after {
                    flusher.abort();
                    return if passed {
                        Ok(())
                    } else {
                        Err("clock checkpoint failed".into())
                    };
                }
                // Keep serving so a human can inspect the room afterwards.
                tracing::info!("simulation finished; still serving. Press Ctrl-C to exit.");
                shutdown_signal().await;
            }
        }
    } else {
        server.await?;
    }

    flusher.abort();
    tracing::info!("coordinator stopped");
    Ok(())
}

/// Six Crockford base-32 characters taken from a fresh ULID's random section.
fn random_room_code() -> String {
    let ulid = Ulid::new().to_string();
    ulid.chars().rev().take(6).collect::<String>().to_uppercase()
}

fn print_banner(app: &App, room_code: &str, room_secret: &str, bound: SocketAddr) {
    let host = display_host(bound.ip());
    let base = format!("http://{host}:{}", bound.port());
    let invite = format!("{base}/#room={room_code}&secret={room_secret}");

    println!();
    println!("  HomeSync coordinator {} — protocol v{}", app.version, homesync_protocol::PROTOCOL_VERSION);
    println!("  ---------------------------------------------");
    println!("  Open on this machine : {base}");
    if let Some(lan) = lan_url(bound) {
        println!("  Open on the LAN      : {lan}");
    }
    println!("  Room code            : {room_code}");
    println!("  Invite link          : {invite}");
    println!("  Media items          : {}", app.media.manifest().items.len());
    println!("  Web assets embedded  : {}", http::web_asset_count());
    println!("  Start lead           : {:.0} ms", app.config.start_lead_ms);
    println!();

    match QrCode::new(lan_url(bound).unwrap_or_else(|| invite.clone()).as_bytes()) {
        Ok(code) => {
            let rendered = code.render::<unicode::Dense1x2>().quiet_zone(true).build();
            println!("{rendered}");
        }
        Err(error) => tracing::warn!(%error, "could not render the invitation QR code"),
    }

    println!("  Scan the code, or open the invite link. The secret travels in the URL");
    println!("  fragment, so it is never sent to the coordinator as part of the request.");
    println!();
}

/// The LAN-reachable invite URL, when a private address can be determined.
fn lan_url(bound: SocketAddr) -> Option<String> {
    if !bound.ip().is_unspecified() {
        return None;
    }
    let ip = local_ip_address::local_ip().ok()?;
    Some(format!("http://{ip}:{}", bound.port()))
}

fn display_host(ip: IpAddr) -> String {
    if ip.is_unspecified() {
        "localhost".to_string()
    } else {
        ip.to_string()
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_codes_are_six_uppercase_characters() {
        for _ in 0..50 {
            let code = random_room_code();
            assert_eq!(code.chars().count(), 6, "code {code}");
            assert!(code.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()), "code {code}");
        }
    }

    #[test]
    fn room_codes_differ_between_calls() {
        // ULIDs generated in the same millisecond share their timestamp
        // section, so the code has to come from the random section.
        let codes: std::collections::HashSet<String> = (0..20).map(|_| random_room_code()).collect();
        assert!(codes.len() > 1, "room codes must not be constant within a millisecond");
    }

    #[test]
    fn unspecified_bind_displays_as_localhost() {
        assert_eq!(display_host("0.0.0.0".parse().unwrap()), "localhost");
        assert_eq!(display_host("192.168.1.50".parse().unwrap()), "192.168.1.50");
    }
}

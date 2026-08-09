//! HomeSync coordinator entry point.

mod calibration;
mod clock;
mod config;
mod discovery;
mod http;
mod media;
mod profiles;
mod room;
mod simulate;
mod state;
mod stream;
mod tls;
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

    let profiles = profiles::ProfileStore::load(config.state_path());
    if config.reset_state {
        profiles.clear();
        tracing::info!("device profiles cleared at startup");
    }

    let media = MediaLibrary::load(&config.media_dir);
    let room_code = config.room_code.clone().unwrap_or_else(random_room_code);
    let room_secret = config.room_secret.clone().unwrap_or_else(|| Ulid::new().to_string());
    let room = Room::new(room_code.clone(), room_secret.clone(), config.start_lead_ns(), config.max_clients);

    let addr = SocketAddr::new(config.bind, config.port);
    let use_tls = config.tls;
    let tls_dir = config.tls_dir.clone();
    let use_mdns = config.mdns;
    let app = Arc::new(App::new(config, media, room, profiles));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    let lan_ip = local_ip_address::local_ip().ok();

    // TLS first: a failure here changes every URL printed in the banner, so it
    // must be resolved before anything is announced.
    let certificate = if use_tls {
        let mut addresses: Vec<IpAddr> = vec![IpAddr::from([127, 0, 0, 1])];
        if let Some(ip) = lan_ip {
            addresses.push(ip);
        }
        if !bound.ip().is_unspecified() {
            addresses.push(bound.ip());
        }
        addresses.sort();
        addresses.dedup();
        let names = vec!["localhost".to_string(), "homesync.local".to_string()];

        match tls::load_or_generate(&tls_dir, &addresses, &names) {
            Ok(certificate) => Some(certificate),
            Err(error) => {
                tracing::error!(%error, "could not prepare TLS; falling back to plain HTTP");
                None
            }
        }
    } else {
        None
    };
    let scheme = if certificate.is_some() { "https" } else { "http" };

    // Best effort: a network that blocks multicast costs a convenience, not
    // the ability to run.
    let _advertisement = if use_mdns {
        match discovery::Advertisement::publish(
            lan_ip.unwrap_or(IpAddr::from([127, 0, 0, 1])),
            bound.port(),
            &room_code,
            certificate.is_some(),
        ) {
            Ok(advertisement) => {
                tracing::info!(name = %advertisement.full_name(), "advertised over mDNS");
                Some(advertisement)
            }
            Err(error) => {
                tracing::info!(%error, "mDNS advertisement unavailable; use the IP address");
                None
            }
        }
    } else {
        None
    };

    print_banner(&app, &room_code, &room_secret, bound, scheme, lan_ip, certificate.as_ref());

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
        // The simulated clients speak plain WebSocket, so the checkpoint
        // harness runs against HTTP only.
        let url = format!("ws://127.0.0.1:{}/ws", bound.port());
        let code = room_code.clone();
        let secret = room_secret.clone();
        Some(tokio::spawn(async move {
            simulate::run(&url, &code, &secret, app.config.simulate, app.config.simulate_seconds).await
        }))
    } else {
        None
    };

    let router = http::router(Arc::clone(&app));
    let server = serve(listener, router, certificate);

    if let Some(simulation) = simulation {
        let exit_after = app.config.simulate_then_exit;
        tokio::select! {
            result = server => result?,
            outcome = simulation => {
                let passed = outcome.unwrap_or(false);
                if exit_after {
                    flusher.abort();
                    app.stop_all_streams();
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
    // Capture threads outlive the socket they feed, so they are stopped
    // explicitly rather than left running until the process exits.
    app.stop_all_streams();
    tracing::info!("coordinator stopped");
    Ok(())
}

/// Serves the router, with TLS when a certificate was prepared.
///
/// The two paths are separate because rustls needs to own the listener, so a
/// plain `axum::serve` cannot simply be wrapped.
async fn serve(
    listener: tokio::net::TcpListener,
    router: axum::Router,
    certificate: Option<tls::Certificate>,
) -> std::io::Result<()> {
    match certificate {
        None => {
            axum::serve(listener, router.into_make_service()).with_graceful_shutdown(shutdown_signal()).await?;
            Ok(())
        }
        Some(certificate) => {
            let config = axum_server::tls_rustls::RustlsConfig::from_pem(
                certificate.certificate_pem.into_bytes(),
                certificate.key_pem.into_bytes(),
            )
            .await
            .map_err(|error| std::io::Error::other(format!("invalid TLS material: {error}")))?;
            let handle = axum_server::Handle::new();
            let shutdown = handle.clone();
            tokio::spawn(async move {
                shutdown_signal().await;
                shutdown.graceful_shutdown(Some(Duration::from_secs(2)));
            });
            let standard = listener.into_std()?;
            // The listener came from tokio, which set it non-blocking; the
            // std-based server expects to manage that itself.
            standard.set_nonblocking(false)?;
            axum_server::from_tcp_rustls(standard, config)
                .map_err(|error| std::io::Error::other(format!("could not adopt the listener: {error}")))?
                .handle(handle)
                .serve(router.into_make_service())
                .await?;
            Ok(())
        }
    }
}

/// Six Crockford base-32 characters taken from a fresh ULID's random section.
fn random_room_code() -> String {
    let ulid = Ulid::new().to_string();
    ulid.chars().rev().take(6).collect::<String>().to_uppercase()
}

/// Prints everything a person needs to get devices into the room.
///
/// The LAN address comes first and the `.local` name second, deliberately:
/// Android does not resolve `.local`, and it is the most common receiver.
#[allow(clippy::too_many_arguments)]
fn print_banner(
    app: &App,
    room_code: &str,
    room_secret: &str,
    bound: SocketAddr,
    scheme: &str,
    lan_ip: Option<IpAddr>,
    certificate: Option<&tls::Certificate>,
) {
    let local = format!("{scheme}://{}:{}", display_host(bound.ip()), bound.port());
    let lan = lan_ip.map(|ip| format!("{scheme}://{ip}:{}", bound.port()));
    let invite_base = lan.clone().unwrap_or_else(|| local.clone());
    let invite = format!("{invite_base}/#room={room_code}&secret={room_secret}");

    println!();
    println!("  HomeSync coordinator {} — protocol v{}", app.version, homesync_protocol::PROTOCOL_VERSION);
    println!("  ---------------------------------------------");
    if let Some(lan) = &lan {
        println!("  Open on the LAN      : {lan}");
    }
    println!("  Open on this machine : {local}");
    if app.config.mdns {
        println!("  Also try             : {scheme}://homesync.local:{}", bound.port());
    }
    println!("  Room code            : {room_code}");
    println!("  Invite link          : {invite}");
    println!("  Media items          : {}", app.media.manifest().items.len());
    println!("  Saved devices        : {}", app.profiles.len());
    println!("  Web assets embedded  : {}", http::web_asset_count());
    println!("  Start lead           : {:.0} ms", app.config.start_lead_ms);
    println!();

    match QrCode::new(invite.as_bytes()) {
        Ok(code) => {
            let rendered = code.render::<unicode::Dense1x2>().quiet_zone(true).build();
            println!("{rendered}");
        }
        Err(error) => tracing::warn!(%error, "could not render the invitation QR code"),
    }

    println!("  Scan the code, or open the invite link. The secret travels in the URL");
    println!("  fragment, so it is never sent to the coordinator as part of the request.");
    println!();

    match certificate {
        Some(certificate) => {
            println!("  HTTPS is on, with a certificate this machine signed itself. Every");
            println!("  device will warn once; accept it, and microphone access — and so");
            println!("  acoustic calibration — becomes available.");
            if certificate.freshly_generated {
                println!("  This certificate is new, so devices that trusted an older one");
                println!("  will ask again.");
            }
            if let Some(path) = &certificate.path {
                println!("  Certificate: {}", path.display());
            }
        }
        None if app.config.tls => {
            println!("  HTTPS was requested but could not be prepared; serving plain HTTP.");
            println!("  Acoustic calibration will not work: browsers refuse microphone");
            println!("  access on an insecure origin.");
        }
        None => {
            println!("  Running over plain HTTP. Acoustic calibration needs a secure");
            println!("  context, so pass --tls when you want to calibrate.");
        }
    }
    if app.config.mdns {
        println!("  Note: Android does not resolve .local names. Use the LAN address there.");
    }
    println!();
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

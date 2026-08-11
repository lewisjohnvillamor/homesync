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

    let media = MediaLibrary::load(&config.media_dirs);

    // The room keeps its identity across restarts. A new code and secret on
    // every start silently invalidates the invite link saved on every device,
    // and the resulting join failure is invisible from the coordinator side.
    let saved_room = profiles.room_identity();
    let room_code = config
        .room_code
        .clone()
        .or_else(|| saved_room.as_ref().map(|room| room.code.clone()))
        .unwrap_or_else(random_room_code);
    let room_secret = config
        .room_secret
        .clone()
        .or_else(|| saved_room.as_ref().map(|room| room.secret.clone()))
        .unwrap_or_else(|| Ulid::new().to_string());
    let room_reused = saved_room.map(|room| room.code == room_code && room.secret == room_secret).unwrap_or(false);
    profiles.set_room_identity(profiles::RoomIdentity { code: room_code.clone(), secret: room_secret.clone() });
    let room = Room::new(room_code.clone(), room_secret.clone(), config.start_lead_ns(), config.max_clients);

    let addr = SocketAddr::new(config.bind, config.port);
    let use_tls = config.tls;
    let tls_dir = config.tls_dir.clone();
    let use_mdns = config.mdns;
    let media_roots = config.media_dirs.clone();
    let app = Arc::new(App::new(config, media, media_roots, room, profiles));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    let lan_addresses = lan_addresses();
    let lan_ip = lan_addresses.first().copied();

    // TLS first: a failure here changes every URL printed in the banner, so it
    // must be resolved before anything is announced.
    let certificate = if use_tls {
        let mut addresses: Vec<IpAddr> = vec![IpAddr::from([127, 0, 0, 1])];
        // Every interface, not just the first: a machine with both Wi-Fi and
        // Ethernet is reachable at either, and a certificate that omits the
        // one a device actually used is rejected outright.
        addresses.extend(lan_addresses.iter().copied());
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

    print_banner(&app, &room_code, &room_secret, bound, scheme, &lan_addresses, certificate.as_ref(), room_reused);

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

/// Every private IPv4 address this machine has, most-likely-first.
///
/// `local_ip()` returns one address, which is wrong on any machine with both
/// Wi-Fi and Ethernet: a device on the other network cannot reach the one it
/// picked, and the failure looks like the coordinator being down.
fn lan_addresses() -> Vec<IpAddr> {
    let mut addresses: Vec<IpAddr> = local_ip_address::list_afinet_netifas()
        .map(|interfaces| {
            interfaces
                .into_iter()
                .map(|(_, ip)| ip)
                // IPv4 only: the invite links and QR codes are typed and
                // scanned by people, and an IPv6 literal in a URL needs
                // brackets and is hopeless on a television remote.
                .filter(|ip| ip.is_ipv4() && !ip.is_loopback() && !ip.is_unspecified())
                .filter(is_private_v4)
                .collect()
        })
        .unwrap_or_default();

    // The interface `local_ip()` would have chosen goes first, so the invite
    // link and QR code keep pointing at the most likely address.
    if let Ok(preferred) = local_ip_address::local_ip() {
        addresses.retain(|ip| *ip != preferred);
        addresses.insert(0, preferred);
    }
    addresses.dedup();
    addresses
}

/// Whether an address is in a private range, so link-local and public
/// addresses do not clutter the banner.
fn is_private_v4(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private(),
        IpAddr::V6(_) => false,
    }
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
    lan_addresses: &[IpAddr],
    certificate: Option<&tls::Certificate>,
    room_reused: bool,
) {
    let local = format!("{scheme}://{}:{}", display_host(bound.ip()), bound.port());
    let lan: Vec<String> = lan_addresses.iter().map(|ip| format!("{scheme}://{ip}:{}", bound.port())).collect();
    let invite_base = lan.first().cloned().unwrap_or_else(|| local.clone());
    let invite = format!("{invite_base}/#room={room_code}&secret={room_secret}");

    println!();
    println!("  HomeSync coordinator {} — protocol v{}", app.version, homesync_protocol::PROTOCOL_VERSION);
    println!("  ---------------------------------------------");
    // Every address, because a device can only reach the coordinator on a
    // network it shares with it. A laptop that cannot open the first address
    // is usually on a different one — a guest SSID, a VPN, another subnet.
    for (index, url) in lan.iter().enumerate() {
        let label = if index == 0 { "Open on the LAN     " } else { "  or                " };
        println!("  {label} : {url}");
    }
    if lan.is_empty() {
        println!("  Open on the LAN      : no private network address found");
    }
    println!("  Open on this machine : {local}");
    if app.config.mdns {
        println!("  Also try             : {scheme}://homesync.local:{}", bound.port());
    }
    println!("  Room code            : {room_code}");
    if !room_reused {
        println!("                         (new — devices holding an older invite must reopen this link)");
    }
    println!("  Invite link          : {invite}");
    println!("  Media items          : {}", app.media_manifest().items.len());
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
    if reachable_from_the_internet(bound.ip(), lan_addresses) {
        println!();
        println!("  WARNING: this coordinator has a public address. HomeSync is built for");
        println!("  a home network, where everyone who can reach it is already trusted:");
        println!("  the room secret is the only credential, it is printed in a QR code for");
        println!("  guests, and it authorises changing the library as well as pressing play.");
        println!("  Put it behind a VPN or a firewall rather than on the open internet.");
    }
    println!();
}

/// Whether the coordinator is listening somewhere the internet can reach.
///
/// Binding `0.0.0.0` is the ordinary case and is not itself the problem — on a
/// home router every address behind it is private. It becomes a problem on a
/// hosted machine, where the same flag exposes the room to anyone. The
/// distinction is not the bind address but whether any address it landed on is
/// routable, which is why this reads the discovered addresses rather than the
/// flag.
fn reachable_from_the_internet(bound: IpAddr, addresses: &[IpAddr]) -> bool {
    let public = |ip: &IpAddr| match ip {
        IpAddr::V4(v4) => !(v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified()),
        IpAddr::V6(v6) => {
            !(v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80)
        }
    };
    if bound.is_unspecified() {
        addresses.iter().any(public)
    } else {
        public(&bound)
    }
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
    fn only_private_ipv4_addresses_are_offered() {
        // Public and link-local addresses are not places a phone on the sofa
        // can reach the coordinator, and an IPv6 literal is unusable on a
        // television remote.
        assert!(is_private_v4(&"192.168.1.50".parse().unwrap()));
        assert!(is_private_v4(&"10.0.0.5".parse().unwrap()));
        assert!(is_private_v4(&"172.16.0.1".parse().unwrap()));
        assert!(!is_private_v4(&"8.8.8.8".parse().unwrap()));
        assert!(!is_private_v4(&"169.254.1.1".parse().unwrap()), "link-local is not routable here");
        assert!(!is_private_v4(&"fe80::1".parse().unwrap()));
    }

    #[test]
    fn the_preferred_address_leads_and_nothing_repeats() {
        // The invite link and QR code use the first entry, so it has to be the
        // one the host would have chosen on its own.
        let addresses = lan_addresses();
        let unique: std::collections::HashSet<_> = addresses.iter().collect();
        assert_eq!(unique.len(), addresses.len(), "an address was listed twice: {addresses:?}");
        if let Ok(preferred) = local_ip_address::local_ip() {
            if addresses.contains(&preferred) {
                assert_eq!(addresses[0], preferred);
            }
        }
    }

    #[test]
    fn unspecified_bind_displays_as_localhost() {
        assert_eq!(display_host("0.0.0.0".parse().unwrap()), "localhost");
        assert_eq!(display_host("192.168.1.50".parse().unwrap()), "192.168.1.50");
    }

    fn ip(raw: &str) -> IpAddr {
        raw.parse().expect("address")
    }

    /// The ordinary case: `0.0.0.0` on a home router. Every address behind it
    /// is private, so binding everything is not an exposure and must not warn —
    /// a warning shown to everyone is a warning nobody reads.
    #[test]
    fn a_home_network_does_not_warn() {
        assert!(!reachable_from_the_internet(ip("0.0.0.0"), &[ip("192.168.1.50"), ip("10.0.0.4")]));
        assert!(!reachable_from_the_internet(ip("127.0.0.1"), &[]));
        assert!(!reachable_from_the_internet(ip("192.168.1.50"), &[ip("192.168.1.50")]));
    }

    #[test]
    fn a_routable_address_warns() {
        assert!(reachable_from_the_internet(ip("0.0.0.0"), &[ip("192.168.1.50"), ip("203.0.113.7")]));
        assert!(reachable_from_the_internet(ip("203.0.113.7"), &[]));
        assert!(reachable_from_the_internet(ip("::"), &[ip("2606:4700::1111")]));
    }

    #[test]
    fn ipv6_private_ranges_are_not_public() {
        assert!(!reachable_from_the_internet(ip("::"), &[ip("fd00::1")]));
        assert!(!reachable_from_the_internet(ip("::"), &[ip("fe80::1")]));
        assert!(!reachable_from_the_internet(ip("::1"), &[]));
    }
}

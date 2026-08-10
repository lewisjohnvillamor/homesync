//! Command-line configuration for the coordinator.

use clap::Parser;
use std::net::IpAddr;
use std::path::PathBuf;

/// HomeSync coordinator: rooms, clock service, media delivery, diagnostics.
#[derive(Debug, Clone, Parser)]
#[command(name = "homesync", version, about)]
pub struct Config {
    /// Address to bind. Defaults to all interfaces so phones on the LAN can
    /// reach the coordinator; set `127.0.0.1` to keep it on this machine only.
    #[arg(long, default_value = "0.0.0.0", env = "HOMESYNC_BIND")]
    pub bind: IpAddr,

    /// TCP port for the HTTP and WebSocket service.
    #[arg(long, default_value_t = 8080, env = "HOMESYNC_PORT")]
    pub port: u16,

    /// Directory scanned for playable audio files. Repeat the flag for several
    /// — a music folder and a mounted drive, say — and they are scanned in the
    /// order given. Folders can also be added later from the interface without
    /// restarting. The built-in click track is always available regardless.
    #[arg(long = "media-dir", default_values_os_t = vec![PathBuf::from("media")], env = "HOMESYNC_MEDIA_DIR")]
    pub media_dirs: Vec<PathBuf>,

    /// How far ahead of "now" playback starts are scheduled, in milliseconds.
    /// Must exceed the worst-case download-free scheduling path: control frame
    /// delivery plus one audio callback on the slowest receiver.
    #[arg(long, default_value_t = 2000.0, env = "HOMESYNC_START_LEAD_MS")]
    pub start_lead_ms: f64,

    /// Maximum receivers allowed in one room.
    #[arg(long, default_value_t = 16, env = "HOMESYNC_MAX_CLIENTS")]
    pub max_clients: usize,

    /// Where per-device profiles are stored. Compensation found by ear or by
    /// calibration is expensive to obtain, so it survives a restart.
    #[arg(long, default_value = "homesync-devices.json", env = "HOMESYNC_STATE_FILE")]
    pub state_file: PathBuf,

    /// Do not read or write the device profile file.
    #[arg(long, default_value_t = false)]
    pub no_state: bool,

    /// Forget every saved device profile at startup.
    #[arg(long, default_value_t = false)]
    pub reset_state: bool,

    /// Serve HTTPS with a self-signed certificate.
    ///
    /// Needed for acoustic calibration: browsers refuse microphone access on a
    /// plain-HTTP LAN address. Each device shows a certificate warning once,
    /// which somebody has to accept.
    #[arg(long, default_value_t = false, env = "HOMESYNC_TLS")]
    pub tls: bool,

    /// Directory the generated certificate and key are kept in, so devices do
    /// not have to accept a new warning after every restart.
    #[arg(long, default_value = ".", env = "HOMESYNC_TLS_DIR")]
    pub tls_dir: PathBuf,

    /// Advertise the coordinator over mDNS as `homesync.local`.
    ///
    /// Resolves on macOS, iOS and Windows; on Linux with Avahi. Android does
    /// not resolve `.local` names, so a phone still needs the IP address.
    #[arg(long, default_value_t = true, env = "HOMESYNC_MDNS", action = clap::ArgAction::Set)]
    pub mdns: bool,

    /// Fixed room code, six characters. Random when omitted.
    #[arg(long, env = "HOMESYNC_ROOM_CODE")]
    pub room_code: Option<String>,

    /// Fixed room secret. Random when omitted. Useful for scripted testing.
    #[arg(long, env = "HOMESYNC_ROOM_SECRET")]
    pub room_secret: Option<String>,

    /// Run N headless clock clients against this coordinator after startup and
    /// print a checkpoint-1 report. Used for automated timing tests.
    #[arg(long, default_value_t = 0)]
    pub simulate: usize,

    /// How long `--simulate` runs, in seconds.
    #[arg(long, default_value_t = 60)]
    pub simulate_seconds: u64,

    /// Exit once `--simulate` finishes instead of continuing to serve.
    #[arg(long, default_value_t = false)]
    pub simulate_then_exit: bool,
}

impl Config {
    /// Path profiles are stored at, or `None` when persistence is disabled.
    pub fn state_path(&self) -> Option<PathBuf> {
        if self.no_state {
            None
        } else {
            Some(self.state_file.clone())
        }
    }

    /// Playback start lead, in nanoseconds.
    pub fn start_lead_ns(&self) -> u64 {
        (self.start_lead_ms.max(0.0) * 1e6) as u64
    }
}

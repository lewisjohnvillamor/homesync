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

    /// Directory scanned for playable audio files at startup. The built-in
    /// click track is always available regardless of this setting.
    #[arg(long, default_value = "media", env = "HOMESYNC_MEDIA_DIR")]
    pub media_dir: PathBuf,

    /// How far ahead of "now" playback starts are scheduled, in milliseconds.
    /// Must exceed the worst-case download-free scheduling path: control frame
    /// delivery plus one audio callback on the slowest receiver.
    #[arg(long, default_value_t = 2000.0, env = "HOMESYNC_START_LEAD_MS")]
    pub start_lead_ms: f64,

    /// Maximum receivers allowed in one room.
    #[arg(long, default_value_t = 16, env = "HOMESYNC_MAX_CLIENTS")]
    pub max_clients: usize,

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
    /// Playback start lead, in nanoseconds.
    pub fn start_lead_ns(&self) -> u64 {
        (self.start_lead_ms.max(0.0) * 1e6) as u64
    }
}

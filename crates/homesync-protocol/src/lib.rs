//! HomeSync control protocol, version 1.
//!
//! Every control message travels as one JSON text frame shaped like
//! [`Envelope`]. The `type` field selects the variant of [`Payload`], so the
//! wire format stays readable in browser devtools while still round-tripping
//! through strongly typed Rust.
//!
//! Time is always expressed in **coordinator monotonic nanoseconds** — the
//! elapsed time since the coordinator process started. Wall-clock time is never
//! used for media scheduling (spec section 9.1).

use serde::{Deserialize, Serialize};

/// Protocol version carried in every envelope.
pub const PROTOCOL_VERSION: u32 = 1;

/// Largest control frame the server will accept, in bytes.
pub const MAX_CONTROL_FRAME_BYTES: usize = 64 * 1024;

/// A single control message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Envelope {
    /// Protocol version. Always [`PROTOCOL_VERSION`] for this build.
    pub v: u32,
    /// Correlates a response with the request that produced it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// Coordinator monotonic nanoseconds at the moment the frame was written.
    /// Absent on client-originated frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_server_ns: Option<u64>,
    /// The message itself.
    #[serde(flatten)]
    pub payload: Payload,
}

impl Envelope {
    /// Builds an envelope for `payload` with no correlation id.
    pub fn new(payload: Payload) -> Self {
        Self { v: PROTOCOL_VERSION, request_id: None, sent_server_ns: None, payload }
    }

    /// Attaches a correlation id, normally copied from the triggering request.
    pub fn with_request_id(mut self, request_id: Option<String>) -> Self {
        self.request_id = request_id;
        self
    }

    /// Stamps the frame with the coordinator's current monotonic clock reading.
    pub fn stamped(mut self, server_ns: u64) -> Self {
        self.sent_server_ns = Some(server_ns);
        self
    }
}

/// Every control message, discriminated by the `type` field on the wire.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum Payload {
    // ---- session establishment -------------------------------------------
    /// First client frame. Announces the client and its capabilities.
    Hello(Hello),
    /// Server response to [`Payload::Hello`], carrying the assigned identity.
    Welcome(Welcome),
    /// Client asks to enter a room. Requires the room secret.
    JoinRoom(JoinRoom),
    /// Client leaves voluntarily. The socket may stay open.
    LeaveRoom,

    // ---- room state ------------------------------------------------------
    /// Authoritative view of the room. Broadcast on every membership or
    /// transport change, and sent once immediately after a successful join.
    ///
    /// Boxed because it is by far the largest variant, and an enum is as big
    /// as its biggest member: without the box, every clock exchange — the
    /// most frequent message in the protocol — would carry a snapshot-sized
    /// hole.
    RoomSnapshot(Box<RoomSnapshot>),
    /// Client updates its own mutable properties (name, role, compensation).
    ClientUpdate(ClientUpdate),

    // ---- clock -----------------------------------------------------------
    /// Client half of the four-timestamp exchange (spec section 9.2).
    ClockPing(ClockPing),
    /// Server half of the four-timestamp exchange.
    ClockPong(ClockPong),
    /// Client publishes its current clock estimate for the diagnostics view.
    ClockReport(ClockReport),

    // ---- media and transport --------------------------------------------
    /// Controller selects the source mode and what to play.
    SelectSource(SelectSource),
    /// Catalogue of media the coordinator can serve.
    MediaManifest(MediaManifest),
    /// Receiver reports that it has fetched, verified and decoded the media.
    ReceiverReady(ReceiverReady),
    /// Authoritative playback timeline. Receivers derive all scheduling from
    /// this single message; see [`Transport`].
    Transport(Transport),
    /// Controller command: start (or resume) playback.
    Play(PlayCommand),
    /// Controller command: pause at the current position.
    Pause,
    /// Controller command: jump to `position_ns` and keep the current state.
    Seek(Seek),
    /// Controller command: stop and unload the current position.
    Stop,
    /// Controller command: set a receiver's gain.
    Volume(Volume),
    /// Controller command: mute or unmute a receiver.
    Mute(Mute),

    // ---- live system audio (Mode C) --------------------------------------
    /// Controller starts capturing and distributing system audio.
    StreamStart(StreamStart),
    /// Controller stops the live stream.
    StreamStop,
    /// Format and buffering parameters of the running stream. Receivers build
    /// their playout buffer from this before any audio frame arrives.
    StreamInfo(StreamInfo),
    /// Receiver's playout buffer health.
    BufferReport(BufferReport),

    // ---- YouTube Together (Mode B) ---------------------------------------
    /// Receiver's view of its own YouTube player.
    YoutubeState(YoutubeState),
    /// Coordinator's instruction to converge on a position at a future time.
    YoutubeRendezvous(YoutubeRendezvous),

    // ---- acoustic calibration --------------------------------------------
    /// Controller starts a calibration run.
    CalibrationStart(CalibrationStart),
    /// Controller aborts a calibration run.
    CalibrationCancel,
    /// Coordinator tells one receiver to emit a chirp at a future instant.
    CalibrationPlay(CalibrationPlay),
    /// Coordinator tells the microphone device to record a window.
    CalibrationRecord(CalibrationRecord),
    /// Progress narration, so the user knows why the room is making noises.
    CalibrationProgress(CalibrationProgress),
    /// Final measurements and the compensation derived from them.
    CalibrationResult(CalibrationResult),

    // ---- diagnostics -----------------------------------------------------
    /// Periodic receiver telemetry (spec section 19).
    DiagnosticReport(DiagnosticReport),
    /// Something went wrong. Never fatal on its own; the socket stays open.
    Error(ErrorMessage),
}

/// Client capability announcement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Hello {
    /// Free-form client build identifier, e.g. `"homesync-web/0.1.0"`.
    pub client_version: String,
    /// Browser/OS family string, best effort.
    #[serde(default)]
    pub user_agent: String,
    /// Identity persisted by the client across reloads, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
}

/// Server acknowledgement of [`Hello`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Welcome {
    /// Identity assigned to this socket for the lifetime of the connection.
    pub client_id: String,
    /// Stable identity the client should persist and send back in `Hello`.
    pub device_id: String,
    /// Protocol version the coordinator speaks.
    pub protocol_version: u32,
    /// Coordinator build version.
    pub server_version: String,
    /// Coordinator monotonic nanoseconds at the moment of writing.
    pub server_ns: u64,
}

/// Room entry request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JoinRoom {
    /// Six-character display code.
    pub room_code: String,
    /// Room secret, delivered out of band through the QR/invite fragment.
    pub secret: String,
    /// Friendly device name shown in the UI.
    #[serde(default)]
    pub name: String,
    /// Requested role.
    #[serde(default)]
    pub role: Role,
}

/// What a device does in the room.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Issues commands but renders no audio.
    Controller,
    /// Renders audio as a full-range/stereo speaker.
    #[default]
    Speaker,
    /// Renders audio, left channel emphasis.
    Left,
    /// Renders audio, right channel emphasis.
    Right,
    /// Renders audio, low frequencies only.
    Subwoofer,
}

impl Role {
    /// Whether this role is expected to produce sound, and therefore whether it
    /// participates in the readiness barrier before playback starts.
    pub fn renders_audio(self) -> bool {
        !matches!(self, Role::Controller)
    }
}

/// Mutable per-client properties a device may change about itself.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ClientUpdate {
    /// New friendly name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// New role.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
    /// Manual timing compensation in milliseconds. Positive means "this device
    /// emits sound late, schedule it earlier by this much" (spec section 3.1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manual_offset_ms: Option<f64>,
    /// Whether this device has a usable microphone for calibration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub microphone_available: Option<bool>,
    /// Linear gain in `0.0..=1.0`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<f32>,
    /// Mute flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted: Option<bool>,
}

/// Client half of the four-timestamp exchange.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClockPing {
    /// Client send time, in the client's own monotonic domain (nanoseconds).
    pub t0: f64,
    /// Monotonically increasing per-connection sample counter.
    #[serde(default)]
    pub seq: u64,
}

/// Server half of the four-timestamp exchange. The client records `t3` on
/// arrival and computes offset and round-trip delay from all four stamps.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClockPong {
    /// Echoed [`ClockPing::t0`].
    pub t0: f64,
    /// Coordinator monotonic nanoseconds at receipt.
    pub t1: u64,
    /// Coordinator monotonic nanoseconds immediately before sending.
    pub t2: u64,
    /// Echoed [`ClockPing::seq`].
    #[serde(default)]
    pub seq: u64,
}

/// How much the coordinator trusts a client's clock estimate (spec 9.4).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClockQuality {
    /// Fewer than the required number of accepted samples so far.
    #[default]
    WarmingUp,
    /// Enough low-jitter samples; safe to schedule playback.
    Stable,
    /// Estimate exists but jitter or staleness exceeds the threshold.
    Degraded,
    /// A discontinuity was detected; the client is restarting its estimate.
    ResyncRequired,
    /// The page was backgrounded or the audio context suspended.
    Suspended,
}

/// A client's own view of its clock, republished for diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ClockReport {
    /// Estimated `server_ns - client_ns`, in nanoseconds.
    pub offset_ns: f64,
    /// Best (lowest) round-trip time seen in the current window, milliseconds.
    pub rtt_min_ms: f64,
    /// Median round-trip time over the current window, milliseconds.
    pub rtt_median_ms: f64,
    /// 95th percentile round-trip time over the current window, milliseconds.
    pub rtt_p95_ms: f64,
    /// Half the spread of accepted offsets — the practical uncertainty of the
    /// offset estimate, in milliseconds.
    pub offset_uncertainty_ms: f64,
    /// Estimated relative clock drift in parts per million.
    pub drift_ppm: f64,
    /// Number of accepted samples in the window.
    pub samples: u32,
    /// Current quality state.
    pub quality: ClockQuality,
}

/// Where the room's audio comes from (specification section 5.2).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SourceMode {
    /// Nothing selected.
    #[default]
    Idle,
    /// Mode A: a local file every receiver preloads and schedules. The
    /// reference mode, and the only one with a guaranteed timing story.
    ControlledAudio,
    /// Mode B: every device runs its own YouTube player, rendezvousing on a
    /// position and a start instant. Best effort; see the caveats in
    /// `docs/protocol.md`.
    Youtube,
    /// Mode C: the host captures system audio and streams timestamped PCM.
    SystemAudio,
}

impl SourceMode {
    /// Whether receivers must preload and hash-verify media before playback.
    pub fn requires_preload(self) -> bool {
        matches!(self, SourceMode::ControlledAudio)
    }

    /// Whether the coordinator's [`Transport`] timeline drives playback.
    /// Live system audio is driven by per-frame presentation times instead.
    pub fn uses_transport_timeline(self) -> bool {
        matches!(self, SourceMode::ControlledAudio | SourceMode::Youtube)
    }
}

/// Controller's source selection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SelectSource {
    /// Which mode to switch to.
    pub mode: SourceMode,
    /// Media identifier from [`MediaManifest`], for [`SourceMode::ControlledAudio`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    /// Video identifier, for [`SourceMode::Youtube`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube_video_id: Option<String>,
}

/// Controller's request to start live system-audio capture.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StreamStart {
    /// Latency profile name: `live`, `movie` or `music`.
    pub profile: String,
    /// Use the built-in synthetic test signal instead of real system audio.
    /// The synthetic source works on every platform, so a room can be proven
    /// before trusting it with real audio.
    #[serde(default)]
    pub synthetic: bool,
}

/// Parameters of the running live stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StreamInfo {
    /// Incremented whenever the stream restarts, so receivers rebuild their
    /// buffers rather than mixing two streams.
    pub epoch: u64,
    /// Samples per second, per channel.
    pub sample_rate: u32,
    /// Channel count.
    pub channels: u16,
    /// Payload encoding: `s16le` or `f32le`.
    pub format: String,
    /// Latency profile in force.
    pub profile: String,
    /// Target playout buffer depth, in milliseconds.
    pub target_depth_ms: f64,
    /// Whether the source is the synthetic test signal.
    pub synthetic: bool,
    /// Human-readable description of what is being captured.
    pub source_description: String,
}

/// Receiver's playout buffer health (specification section 11.2, step 7).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct BufferReport {
    /// Current buffered audio, in milliseconds.
    pub depth_ms: f64,
    /// Target depth, in milliseconds.
    pub target_ms: f64,
    /// Whether the buffer has primed and is rendering.
    pub primed: bool,
    /// Render calls that ran out of audio.
    pub underruns: u32,
    /// Frames dropped because the buffer was over its ceiling.
    pub overruns: u32,
    /// Frames that arrived after their presentation time.
    pub late_frames: u32,
    /// Duplicate or reordered frames dropped.
    pub duplicate_frames: u32,
    /// Times the buffer emptied and had to re-prime.
    pub reprimes: u32,
}

/// A receiver's view of its own YouTube player.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct YoutubeState {
    /// Video the player is loaded with.
    #[serde(default)]
    pub video_id: String,
    /// IFrame API player state: `unstarted`, `ended`, `playing`, `paused`,
    /// `buffering` or `cued`.
    pub player_state: String,
    /// Player position, in seconds.
    pub current_time_s: f64,
    /// Video duration in seconds, once known.
    #[serde(default)]
    pub duration_s: f64,
    /// Fraction of the video buffered, `0.0..=1.0`.
    #[serde(default)]
    pub buffered_fraction: f64,
    /// Whether the player has reported ready.
    #[serde(default)]
    pub ready: bool,
    /// Measured delay between calling `playVideo()` and playback actually
    /// starting, in milliseconds. The coordinator maintains a bounded moving
    /// average of this per device and starts each device early by that much.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_start_latency_ms: Option<f64>,
}

/// Instruction to converge every player on one position at one instant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct YoutubeRendezvous {
    /// Incremented per rendezvous attempt.
    pub epoch: u64,
    /// Video everyone should be playing.
    pub video_id: String,
    /// Position to be at when the rendezvous instant arrives, in seconds.
    pub target_position_s: f64,
    /// Coordinator instant at which playback should be running.
    pub start_server_ns: u64,
    /// This device's learned start latency, in milliseconds. It should call
    /// `playVideo()` this far ahead of `start_server_ns`.
    pub start_latency_ms: f64,
}

/// Controller's request to begin acoustic calibration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationStart {
    /// Device whose microphone will listen. Normally a phone, held where the
    /// listener will actually sit.
    pub microphone_client_id: String,
    /// Chirps per device. More repetitions reject more noise; five is the
    /// specification's minimum.
    #[serde(default = "default_repetitions")]
    pub repetitions: u32,
}

fn default_repetitions() -> u32 {
    5
}

/// Instruction to one receiver to emit a chirp.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationPlay {
    /// Calibration run this belongs to. Stale runs are ignored.
    pub session_id: String,
    /// Chirp assigned to this device; also selects the audio to fetch.
    pub chirp_code: u32,
    /// URL of the chirp audio.
    pub chirp_url: String,
    /// Coordinator instant at which the chirp should be *heard*. The receiver
    /// applies its usual compensation, so a calibration measures the same
    /// scheduling path that ordinary playback uses.
    pub start_server_ns: u64,
    /// Repetition index, from zero.
    pub repetition: u32,
}

/// Instruction to the microphone device to record a window.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationRecord {
    /// Calibration run this belongs to.
    pub session_id: String,
    /// Device being measured.
    pub target_client_id: String,
    /// Chirp code the target will emit.
    pub chirp_code: u32,
    /// Coordinator instant the target is scheduled to be heard at. The
    /// recording starts slightly before this and the coordinator subtracts the
    /// difference, so a measured delay is relative to the scheduled instant.
    pub start_server_ns: u64,
    /// How long to record, in milliseconds.
    pub duration_ms: f64,
    /// Repetition index, from zero.
    pub repetition: u32,
}

/// Narration of a calibration run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationProgress {
    /// Calibration run this belongs to.
    pub session_id: String,
    /// What is happening: `preparing`, `measuring`, `analysing`, `done`,
    /// `cancelled` or `failed`.
    pub stage: String,
    /// Device currently being measured, when one is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// Measurements completed so far.
    pub completed: u32,
    /// Measurements planned in total.
    pub total: u32,
    /// Human-readable detail.
    #[serde(default)]
    pub detail: String,
}

/// One device's calibration outcome.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationMeasurement {
    /// Device measured.
    pub client_id: String,
    /// Friendly name at the time of measurement.
    pub name: String,
    /// Median acoustic arrival delay relative to the scheduled instant, in
    /// milliseconds.
    pub measured_delay_ms: f64,
    /// Spread across repetitions, in milliseconds. A large value means the
    /// device's latency is not stable and no fixed compensation will hold.
    pub deviation_ms: f64,
    /// Repetitions kept.
    pub accepted: u32,
    /// Repetitions discarded.
    pub rejected: u32,
    /// The device's latency with no compensation at all, in milliseconds.
    pub intrinsic_latency_ms: f64,
    /// Compensation the coordinator applied, in milliseconds.
    pub applied_compensation_ms: f64,
    /// Whether the repetitions agreed closely enough to trust.
    pub stable: bool,
    /// Set when an earlier, quieter arrival was preferred over a louder later
    /// one — a sign of a reflective room, and worth telling the user.
    #[serde(default)]
    pub reflective_room: bool,
}

/// Result of a calibration run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CalibrationResult {
    /// Calibration run this belongs to.
    pub session_id: String,
    /// Whether compensation was actually applied.
    pub applied: bool,
    /// Per-device outcomes.
    pub measurements: Vec<CalibrationMeasurement>,
    /// Explanation, especially when nothing was applied.
    #[serde(default)]
    pub detail: String,
}

/// Catalogue of everything the coordinator can serve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MediaManifest {
    /// Available media, in display order.
    pub items: Vec<MediaItem>,
}

/// One playable item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaItem {
    /// Opaque identifier used in URLs and transport messages.
    pub id: String,
    /// Human-readable title.
    pub title: String,
    /// Byte length of the encoded file.
    pub bytes: u64,
    /// Lowercase hex SHA-256 of the encoded file. Receivers verify this before
    /// declaring readiness (spec section 8.2).
    pub sha256: String,
    /// MIME type used when serving the file.
    pub content_type: String,
    /// Duration in nanoseconds when the coordinator knows it, else `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ns: Option<u64>,
    /// True for media the coordinator synthesised itself, such as the built-in
    /// click track used for calibration and checkpoint testing.
    #[serde(default)]
    pub builtin: bool,
}

/// Receiver's readiness report for one media item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReceiverReady {
    /// Media the report refers to. Stale ids are ignored by the coordinator.
    pub media_id: String,
    /// Whether the SHA-256 of the downloaded bytes matched the manifest.
    pub hash_verified: bool,
    /// Decoded duration in nanoseconds.
    pub duration_ns: u64,
    /// Hardware sample rate of the receiver's audio context.
    pub sample_rate: u32,
    /// `AudioContext.state` at the time of the report.
    pub audio_context_state: String,
    /// Base + output latency reported by the audio context, in milliseconds.
    #[serde(default)]
    pub output_latency_ms: f64,
}

/// Playback state of the room.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TransportState {
    /// No media selected.
    #[default]
    Idle,
    /// Media selected; receivers are downloading and decoding.
    Loading,
    /// All required receivers are ready and waiting for a play command.
    Ready,
    /// Playback is scheduled or running.
    Playing,
    /// Playback is held at [`Transport::anchor_media_ns`].
    Paused,
}

/// The authoritative playback timeline.
///
/// This is the only message receivers need in order to schedule audio, which is
/// what makes late joins, resumes and seeks all follow one code path. The
/// media position at coordinator time `now` is:
///
/// ```text
/// position = anchor_media_ns + (now - anchor_server_ns)   // when playing
/// position = anchor_media_ns                              // otherwise
/// ```
///
/// When playing, `anchor_server_ns` is normally in the future: it is the
/// coordinator's chosen presentation time, at least `start_lead` ahead of the
/// broadcast so every receiver has time to schedule against it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Transport {
    /// Incremented on every transport change. Receivers reschedule only when
    /// this changes, so duplicate snapshots are free.
    pub epoch: u64,
    /// Current state.
    pub state: TransportState,
    /// Which source mode this timeline drives.
    #[serde(default)]
    pub mode: SourceMode,
    /// Selected media, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    /// Selected YouTube video, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube_video_id: Option<String>,
    /// Coordinator monotonic nanoseconds the timeline is anchored to.
    pub anchor_server_ns: u64,
    /// Media position, in nanoseconds, at `anchor_server_ns`.
    pub anchor_media_ns: u64,
}

impl Transport {
    /// Media position at coordinator time `now_ns`, in nanoseconds.
    pub fn position_at(&self, now_ns: u64) -> u64 {
        if self.state != TransportState::Playing {
            return self.anchor_media_ns;
        }
        // Before the anchor the timeline has not started yet, so the position
        // stays pinned at the anchor rather than going negative.
        let elapsed = now_ns.saturating_sub(self.anchor_server_ns);
        self.anchor_media_ns + elapsed
    }
}

/// Play command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PlayCommand {
    /// Start even though some receivers have not verified the media or have not
    /// reached a `stable` clock. The coordinator refuses otherwise, per spec
    /// section 9.4.
    #[serde(default)]
    pub force: bool,
}

/// Seek request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Seek {
    /// Target media position in nanoseconds.
    pub position_ns: u64,
}

/// Gain command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Volume {
    /// Target client, or `None` for the sender itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// Linear gain in `0.0..=1.0`.
    pub volume: f32,
}

/// Mute command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mute {
    /// Target client, or `None` for the sender itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// Desired mute state.
    pub muted: bool,
}

/// Full room state as the coordinator sees it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RoomSnapshot {
    /// Six-character display code.
    pub room_code: String,
    /// Client id of the room owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_client_id: Option<String>,
    /// Everyone currently connected to the room.
    pub clients: Vec<ClientInfo>,
    /// Current playback timeline.
    pub transport: Transport,
    /// Media catalogue.
    pub media: MediaManifest,
    /// How far ahead of "now" the coordinator schedules playback starts, in
    /// milliseconds (spec section 10, step 4).
    pub start_lead_ms: f64,
    /// Live stream parameters, when one is running.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream: Option<StreamInfo>,
    /// Calibration progress, when a run is in flight.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calibration: Option<CalibrationProgress>,
    /// Source modes this coordinator build actually implements.
    #[serde(default)]
    pub supported_modes: Vec<SourceMode>,
}

/// One participant, as published to every other participant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClientInfo {
    /// Per-connection identity.
    pub client_id: String,
    /// Stable per-device identity.
    pub device_id: String,
    /// Friendly name.
    pub name: String,
    /// Current role.
    pub role: Role,
    /// Manual timing compensation in milliseconds, set by the user.
    pub manual_offset_ms: f64,
    /// Timing compensation in milliseconds derived from acoustic calibration.
    /// Kept separate from the manual value so a calibration run never silently
    /// discards a human's adjustment, and so the UI can show which is which.
    #[serde(default)]
    pub acoustic_offset_ms: f64,
    /// Linear gain.
    pub volume: f32,
    /// Mute state.
    pub muted: bool,
    /// Whether this client has verified and decoded the selected media.
    pub ready: bool,
    /// Whether this device can act as a calibration microphone.
    #[serde(default)]
    pub microphone_available: bool,
    /// Latest clock estimate the client published.
    pub clock: ClockReport,
    /// Latest telemetry the client published.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<DiagnosticReport>,
    /// Latest live-stream buffer health, when streaming.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buffer: Option<BufferReport>,
    /// Latest YouTube player state, in YouTube mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube: Option<YoutubeState>,
}

impl ClientInfo {
    /// Total timing compensation this device applies, in milliseconds.
    pub fn total_offset_ms(&self) -> f64 {
        self.manual_offset_ms + self.acoustic_offset_ms
    }
}

/// Periodic receiver telemetry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DiagnosticReport {
    /// Hardware sample rate of the audio context.
    #[serde(default)]
    pub sample_rate: u32,
    /// `AudioContext.state`.
    #[serde(default)]
    pub audio_context_state: String,
    /// Base + output latency of the audio context, in milliseconds.
    #[serde(default)]
    pub output_latency_ms: f64,
    /// Coordinator time the receiver intended to begin output, nanoseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_start_server_ns: Option<u64>,
    /// Difference between the scheduled and the achieved start, milliseconds.
    /// Non-zero when the receiver had to clamp a start time into the past.
    #[serde(default)]
    pub schedule_error_ms: f64,
    /// Receiver's estimate of its own media position, nanoseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_ns: Option<u64>,
    /// Receiver position minus coordinator position, milliseconds. This is the
    /// number that must stay small for the room to sound synchronised.
    #[serde(default)]
    pub drift_ms: f64,
    /// Whether the document is currently visible.
    #[serde(default)]
    pub page_visible: bool,
    /// Count of suspend/resume transitions since page load.
    #[serde(default)]
    pub suspend_events: u32,
    /// Count of coordinated restarts caused by excessive drift.
    #[serde(default)]
    pub resync_count: u32,
}

/// Machine-readable failure notice.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ErrorMessage {
    /// Stable error code, e.g. `"bad_secret"`.
    pub code: String,
    /// Human-readable explanation.
    pub message: String,
}

impl ErrorMessage {
    /// Convenience constructor.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(payload: Payload) {
        let env = Envelope::new(payload.clone()).stamped(42);
        let text = serde_json::to_string(&env).expect("serialize");
        let back: Envelope = serde_json::from_str(&text).expect("deserialize");
        assert_eq!(env, back, "round-trip changed the message: {text}");
    }

    #[test]
    fn every_message_round_trips() {
        roundtrip(Payload::Hello(Hello {
            client_version: "homesync-web/0.1.0".into(),
            user_agent: "test".into(),
            device_id: Some("dev-1".into()),
        }));
        roundtrip(Payload::Welcome(Welcome {
            client_id: "c1".into(),
            device_id: "dev-1".into(),
            protocol_version: PROTOCOL_VERSION,
            server_version: "0.1.0".into(),
            server_ns: 1,
        }));
        roundtrip(Payload::JoinRoom(JoinRoom {
            room_code: "ABC123".into(),
            secret: "s".into(),
            name: "Kitchen".into(),
            role: Role::Left,
        }));
        roundtrip(Payload::LeaveRoom);
        roundtrip(Payload::ClockPing(ClockPing { t0: 1.5, seq: 3 }));
        roundtrip(Payload::ClockPong(ClockPong { t0: 1.5, t1: 2, t2: 3, seq: 3 }));
        roundtrip(Payload::ClockReport(ClockReport::default()));
        roundtrip(Payload::SelectSource(SelectSource {
            mode: SourceMode::ControlledAudio,
            media_id: Some("m".into()),
            youtube_video_id: None,
        }));
        roundtrip(Payload::Transport(Transport::default()));
        roundtrip(Payload::StreamStart(StreamStart { profile: "music".into(), synthetic: true }));
        roundtrip(Payload::StreamStop);
        roundtrip(Payload::StreamInfo(StreamInfo::default()));
        roundtrip(Payload::BufferReport(BufferReport::default()));
        roundtrip(Payload::YoutubeState(YoutubeState::default()));
        roundtrip(Payload::YoutubeRendezvous(YoutubeRendezvous::default()));
        roundtrip(Payload::CalibrationStart(CalibrationStart { microphone_client_id: "c1".into(), repetitions: 5 }));
        roundtrip(Payload::CalibrationCancel);
        roundtrip(Payload::CalibrationPlay(CalibrationPlay {
            session_id: "s".into(),
            chirp_code: 1,
            chirp_url: "/api/v1/calibration/chirp/1.wav".into(),
            start_server_ns: 5,
            repetition: 0,
        }));
        roundtrip(Payload::CalibrationRecord(CalibrationRecord {
            session_id: "s".into(),
            target_client_id: "c1".into(),
            chirp_code: 1,
            start_server_ns: 5,
            duration_ms: 900.0,
            repetition: 0,
        }));
        roundtrip(Payload::CalibrationProgress(CalibrationProgress {
            session_id: "s".into(),
            stage: "measuring".into(),
            client_id: Some("c1".into()),
            completed: 1,
            total: 10,
            detail: String::new(),
        }));
        roundtrip(Payload::CalibrationResult(CalibrationResult::default()));
        roundtrip(Payload::Play(PlayCommand { force: true }));
        roundtrip(Payload::Pause);
        roundtrip(Payload::Seek(Seek { position_ns: 5 }));
        roundtrip(Payload::Stop);
        roundtrip(Payload::Volume(Volume { client_id: None, volume: 0.5 }));
        roundtrip(Payload::Mute(Mute { client_id: Some("c1".into()), muted: true }));
        roundtrip(Payload::DiagnosticReport(DiagnosticReport::default()));
        roundtrip(Payload::Error(ErrorMessage::new("x", "y")));
    }

    #[test]
    fn envelope_uses_a_flat_type_tag() {
        let env = Envelope::new(Payload::Stop);
        let value = serde_json::to_value(&env).expect("serialize");
        assert_eq!(value["type"], "stop");
        assert_eq!(value["v"], PROTOCOL_VERSION);
    }

    #[test]
    fn unknown_message_types_are_rejected_not_silently_accepted() {
        let err = serde_json::from_str::<Envelope>(r#"{"v":1,"type":"nonsense"}"#);
        assert!(err.is_err(), "unknown types must fail to parse");
    }

    #[test]
    fn source_modes_declare_what_they_need() {
        assert!(SourceMode::ControlledAudio.requires_preload());
        assert!(!SourceMode::Youtube.requires_preload(), "YouTube media is never ours to preload");
        assert!(!SourceMode::SystemAudio.requires_preload(), "live audio has nothing to preload");

        assert!(SourceMode::ControlledAudio.uses_transport_timeline());
        assert!(SourceMode::Youtube.uses_transport_timeline());
        assert!(
            !SourceMode::SystemAudio.uses_transport_timeline(),
            "live audio is driven by per-frame presentation times"
        );
    }

    #[test]
    fn total_compensation_combines_manual_and_acoustic() {
        // Calibration must never silently discard a human's adjustment.
        let client = ClientInfo {
            client_id: "c".into(),
            device_id: "d".into(),
            name: "n".into(),
            role: Role::Speaker,
            manual_offset_ms: 12.0,
            acoustic_offset_ms: -140.0,
            volume: 1.0,
            muted: false,
            ready: true,
            microphone_available: false,
            clock: ClockReport::default(),
            diagnostics: None,
            buffer: None,
            youtube: None,
        };
        assert_eq!(client.total_offset_ms(), -128.0);
    }

    #[test]
    fn position_advances_only_while_playing() {
        let t = Transport {
            epoch: 1,
            state: TransportState::Playing,
            mode: SourceMode::ControlledAudio,
            media_id: Some("m".into()),
            youtube_video_id: None,
            anchor_server_ns: 1_000,
            anchor_media_ns: 500,
        };
        assert_eq!(t.position_at(1_000), 500);
        assert_eq!(t.position_at(1_750), 1_250);

        // Before the anchor, the position stays pinned rather than underflowing.
        assert_eq!(t.position_at(0), 500);

        let paused = Transport { state: TransportState::Paused, ..t };
        assert_eq!(paused.position_at(9_999), 500);
    }

    #[test]
    fn controllers_are_excluded_from_the_readiness_barrier() {
        assert!(!Role::Controller.renders_audio());
        for role in [Role::Speaker, Role::Left, Role::Right, Role::Subwoofer] {
            assert!(role.renders_audio(), "{role:?} should render audio");
        }
    }
}

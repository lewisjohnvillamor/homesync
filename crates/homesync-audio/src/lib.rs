//! Audio plumbing for HomeSync: framing, playout buffering, capture and WAV.
//!
//! Nothing here knows about rooms, sockets or HTTP. That separation is what
//! lets the live-streaming path be tested exhaustively against synthetic loss,
//! reordering and clock skew without standing up a coordinator.

pub mod capture;
pub mod frame;
pub mod framer;
pub mod playout;
pub mod wav;

pub use capture::{CaptureFormat, CaptureSource, SyntheticCapture};
pub use frame::{decode, encode, Format, FrameHeader};
pub use framer::{Framer, OutgoingFrame, FRAME_SAMPLES};
pub use playout::{LatencyProfile, PlayoutBuffer, PlayoutStats};

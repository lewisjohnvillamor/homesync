//! Binary PCM frame v1 (specification section 11.4).
//!
//! One frame carries a fixed slice of audio plus the coordinator time at which
//! it should be *heard*. Receivers never play a frame when it arrives — they
//! place it in a ring buffer and render it at its presentation time, which is
//! what lets a jittery Wi-Fi link still produce aligned output.
//!
//! All integer fields are network byte order.

/// Frame magic: `HSYN`.
pub const MAGIC: [u8; 4] = *b"HSYN";

/// Protocol version of this frame layout.
pub const VERSION: u8 = 1;

/// Bytes before the payload.
pub const HEADER_BYTES: usize = 4 + 1 + 1 + 1 + 1 + 4 + 8 + 8 + 2 + 4;

/// Largest payload accepted, a guard against a hostile or corrupt sender.
/// One second of 48 kHz stereo float is far beyond any legitimate frame.
pub const MAX_PAYLOAD_BYTES: usize = 48_000 * 2 * 4;

/// Sample encoding of a frame payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// Interleaved signed 16-bit little-endian.
    S16Le,
    /// Interleaved 32-bit float little-endian.
    F32Le,
}

impl Format {
    /// Wire value.
    pub fn code(self) -> u8 {
        match self {
            Format::S16Le => 1,
            Format::F32Le => 2,
        }
    }

    /// Parses a wire value. Code 3 is reserved for Opus and is not implemented.
    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Format::S16Le),
            2 => Some(Format::F32Le),
            _ => None,
        }
    }

    /// Bytes per sample per channel.
    pub fn bytes_per_sample(self) -> usize {
        match self {
            Format::S16Le => 2,
            Format::F32Le => 4,
        }
    }
}

/// Frame flags.
pub mod flags {
    /// The stream jumped: the receiver should reset its buffer rather than
    /// trying to bridge the gap.
    pub const DISCONTINUITY: u8 = 0b0000_0001;
    /// The payload is known to be silence. Sent so a receiver can keep its
    /// timeline without the bandwidth.
    pub const SILENCE: u8 = 0b0000_0010;
    /// Part of a calibration sequence rather than programme audio.
    pub const CALIBRATION: u8 = 0b0000_0100;
}

/// A decoded frame header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    /// Bitwise combination of [`flags`].
    pub flags: u8,
    /// Payload encoding.
    pub format: Format,
    /// Channel count.
    pub channels: u8,
    /// Sample rate in hertz.
    pub sample_rate: u32,
    /// Monotonic stream frame number, used to detect loss and reordering.
    pub sequence: u64,
    /// Coordinator monotonic nanoseconds at which this frame should be heard.
    pub presentation_ns: u64,
    /// Samples per channel in the payload.
    pub frame_samples: u16,
}

impl FrameHeader {
    /// Duration of this frame, in nanoseconds.
    pub fn duration_ns(&self) -> u64 {
        if self.sample_rate == 0 {
            return 0;
        }
        self.frame_samples as u64 * 1_000_000_000 / self.sample_rate as u64
    }

    /// Expected payload length in bytes.
    pub fn payload_bytes(&self) -> usize {
        self.frame_samples as usize * self.channels as usize * self.format.bytes_per_sample()
    }
}

/// Why a frame could not be decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    /// Fewer bytes than a header, or fewer than the declared payload.
    Truncated,
    /// The magic did not match: this is not a HomeSync frame.
    BadMagic,
    /// A version this build does not implement.
    UnsupportedVersion(u8),
    /// A format code this build does not implement, such as Opus.
    UnsupportedFormat(u8),
    /// Channel count of zero, or more than this build supports.
    BadChannelCount(u8),
    /// A sample rate outside anything a sound card produces.
    BadSampleRate(u32),
    /// The declared payload length disagrees with the sample count, or exceeds
    /// [`MAX_PAYLOAD_BYTES`].
    BadPayloadLength,
}

/// Largest channel count accepted.
pub const MAX_CHANNELS: u8 = 8;

/// Serialises a frame.
pub fn encode(header: &FrameHeader, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_BYTES + payload.len());
    out.extend_from_slice(&MAGIC);
    out.push(VERSION);
    out.push(header.flags);
    out.push(header.format.code());
    out.push(header.channels);
    out.extend_from_slice(&header.sample_rate.to_be_bytes());
    out.extend_from_slice(&header.sequence.to_be_bytes());
    out.extend_from_slice(&header.presentation_ns.to_be_bytes());
    out.extend_from_slice(&header.frame_samples.to_be_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

/// Parses a frame, returning the header and a borrow of the payload.
///
/// Every field is validated before the payload is touched. A receiver renders
/// whatever this returns straight into an audio callback, so a malformed frame
/// must fail here rather than become a burst of noise at full volume.
pub fn decode(bytes: &[u8]) -> Result<(FrameHeader, &[u8]), DecodeError> {
    if bytes.len() < HEADER_BYTES {
        return Err(DecodeError::Truncated);
    }
    if bytes[0..4] != MAGIC {
        return Err(DecodeError::BadMagic);
    }
    let version = bytes[4];
    if version != VERSION {
        return Err(DecodeError::UnsupportedVersion(version));
    }
    let flags = bytes[5];
    let format_code = bytes[6];
    let format = Format::from_code(format_code).ok_or(DecodeError::UnsupportedFormat(format_code))?;
    let channels = bytes[7];
    if channels == 0 || channels > MAX_CHANNELS {
        return Err(DecodeError::BadChannelCount(channels));
    }
    let sample_rate = u32::from_be_bytes(bytes[8..12].try_into().expect("4 bytes"));
    if !(8_000..=192_000).contains(&sample_rate) {
        return Err(DecodeError::BadSampleRate(sample_rate));
    }
    let sequence = u64::from_be_bytes(bytes[12..20].try_into().expect("8 bytes"));
    let presentation_ns = u64::from_be_bytes(bytes[20..28].try_into().expect("8 bytes"));
    let frame_samples = u16::from_be_bytes(bytes[28..30].try_into().expect("2 bytes"));
    let payload_length = u32::from_be_bytes(bytes[30..34].try_into().expect("4 bytes")) as usize;

    if payload_length > MAX_PAYLOAD_BYTES {
        return Err(DecodeError::BadPayloadLength);
    }
    if bytes.len() < HEADER_BYTES + payload_length {
        return Err(DecodeError::Truncated);
    }

    let header = FrameHeader { flags, format, channels, sample_rate, sequence, presentation_ns, frame_samples };
    // A silence frame is allowed to carry no payload at all; anything else must
    // match its declared sample count exactly.
    let expected = header.payload_bytes();
    let silent = flags & flags::SILENCE != 0;
    if payload_length != expected && !(silent && payload_length == 0) {
        return Err(DecodeError::BadPayloadLength);
    }

    Ok((header, &bytes[HEADER_BYTES..HEADER_BYTES + payload_length]))
}

/// Converts an interleaved float payload to signed 16-bit, clipping rather
/// than wrapping. A wrapped sample is full-scale noise in the opposite
/// direction — far worse than the clipping it replaces.
pub fn f32_to_s16le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = (clamped * i16::MAX as f32).round() as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

/// Decodes a signed 16-bit little-endian payload into floats.
pub fn s16le_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(2).map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header() -> FrameHeader {
        FrameHeader {
            flags: 0,
            format: Format::S16Le,
            channels: 2,
            sample_rate: 48_000,
            sequence: 42,
            presentation_ns: 1_234_567_890,
            frame_samples: 480,
        }
    }

    #[test]
    fn round_trips_a_frame() {
        let header = header();
        let payload = vec![7u8; header.payload_bytes()];
        let encoded = encode(&header, &payload);

        assert_eq!(encoded.len(), HEADER_BYTES + payload.len());
        let (decoded, decoded_payload) = decode(&encoded).expect("decode");
        assert_eq!(decoded, header);
        assert_eq!(decoded_payload, &payload[..]);
    }

    #[test]
    fn header_size_matches_the_specification() {
        // 4 magic + version + flags + format + channels + 4 rate + 8 sequence
        // + 8 presentation + 2 samples + 4 length.
        assert_eq!(HEADER_BYTES, 34);
    }

    #[test]
    fn ten_millisecond_frames_report_ten_milliseconds() {
        let header = FrameHeader { frame_samples: 480, sample_rate: 48_000, ..header() };
        assert_eq!(header.duration_ns(), 10_000_000);
    }

    #[test]
    fn rejects_a_foreign_or_truncated_frame() {
        let header = header();
        let encoded = encode(&header, &vec![0u8; header.payload_bytes()]);

        assert_eq!(decode(&[]), Err(DecodeError::Truncated));
        assert_eq!(decode(&encoded[..HEADER_BYTES - 1]), Err(DecodeError::Truncated));
        assert_eq!(decode(&encoded[..HEADER_BYTES + 10]), Err(DecodeError::Truncated));

        let mut foreign = encoded.clone();
        foreign[0] = b'X';
        assert_eq!(decode(&foreign), Err(DecodeError::BadMagic));
    }

    #[test]
    fn rejects_unsupported_versions_and_formats() {
        let header = header();
        let encoded = encode(&header, &vec![0u8; header.payload_bytes()]);

        let mut future = encoded.clone();
        future[4] = 2;
        assert_eq!(decode(&future), Err(DecodeError::UnsupportedVersion(2)));

        // Format 3 is reserved for Opus, which this build does not implement.
        let mut opus = encoded.clone();
        opus[6] = 3;
        assert_eq!(decode(&opus), Err(DecodeError::UnsupportedFormat(3)));
    }

    #[test]
    fn rejects_impossible_channel_counts_and_sample_rates() {
        let header = header();
        let encoded = encode(&header, &vec![0u8; header.payload_bytes()]);

        let mut zero_channels = encoded.clone();
        zero_channels[7] = 0;
        assert_eq!(decode(&zero_channels), Err(DecodeError::BadChannelCount(0)));

        let mut many_channels = encoded.clone();
        many_channels[7] = 64;
        assert_eq!(decode(&many_channels), Err(DecodeError::BadChannelCount(64)));

        let mut silly_rate = encoded.clone();
        silly_rate[8..12].copy_from_slice(&1u32.to_be_bytes());
        assert_eq!(decode(&silly_rate), Err(DecodeError::BadSampleRate(1)));
    }

    #[test]
    fn rejects_a_payload_length_that_disagrees_with_the_sample_count() {
        // The dangerous case: a header claiming 480 stereo samples with only a
        // handful of bytes behind it. Rendering that reads past the payload.
        let header = header();
        let mut encoded = encode(&header, &vec![0u8; header.payload_bytes()]);
        encoded[30..34].copy_from_slice(&4u32.to_be_bytes());
        encoded.truncate(HEADER_BYTES + 4);
        assert_eq!(decode(&encoded), Err(DecodeError::BadPayloadLength));
    }

    #[test]
    fn rejects_an_absurd_payload_length_without_allocating() {
        let header = header();
        let mut encoded = encode(&header, &vec![0u8; header.payload_bytes()]);
        encoded[30..34].copy_from_slice(&u32::MAX.to_be_bytes());
        assert_eq!(decode(&encoded), Err(DecodeError::BadPayloadLength));
    }

    #[test]
    fn a_silence_frame_may_carry_no_payload() {
        let header = FrameHeader { flags: flags::SILENCE, ..header() };
        let encoded = encode(&header, &[]);
        let (decoded, payload) = decode(&encoded).expect("decode");
        assert_eq!(decoded.flags & flags::SILENCE, flags::SILENCE);
        assert!(payload.is_empty());
        // But it still describes the time it occupies.
        assert_eq!(decoded.duration_ns(), 10_000_000);
    }

    #[test]
    fn float_conversion_clips_instead_of_wrapping() {
        let bytes = f32_to_s16le(&[0.0, 1.0, -1.0, 2.5, -2.5]);
        let values: Vec<i16> = bytes.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(values[0], 0);
        assert_eq!(values[1], i16::MAX);
        assert_eq!(values[2], -i16::MAX);
        assert_eq!(values[3], i16::MAX, "over-range must clip, not wrap to negative");
        assert_eq!(values[4], -i16::MAX);
    }

    #[test]
    fn float_conversion_round_trips_within_quantisation_error() {
        let original: Vec<f32> = (0..1000).map(|i| ((i as f32) / 500.0 - 1.0) * 0.95).collect();
        let recovered = s16le_to_f32(&f32_to_s16le(&original));
        assert_eq!(recovered.len(), original.len());
        for (a, b) in original.iter().zip(recovered.iter()) {
            assert!((a - b).abs() < 1.0 / 32_767.0, "{a} vs {b}");
        }
    }

    #[test]
    fn a_partial_trailing_sample_is_ignored_rather_than_read_out_of_bounds() {
        assert_eq!(s16le_to_f32(&[0x00, 0x40, 0x11]).len(), 1);
    }
}

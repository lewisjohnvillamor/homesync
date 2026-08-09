//! Minimal PCM WAV reading and writing.
//!
//! Only what the coordinator needs: write signals it synthesises (the click
//! track, calibration chirps) and read back the duration of a WAV a user
//! dropped into the media directory.

/// Serialises interleaved signed 16-bit samples as a canonical PCM WAV file.
pub fn write_s16(samples: &[i16], sample_rate: u32, channels: u16) -> Vec<u8> {
    let bits_per_sample: u16 = 16;
    let block_align = channels * bits_per_sample / 8;
    let byte_rate = sample_rate * block_align as u32;
    let data_len = (samples.len() * 2) as u32;

    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Serialises interleaved float samples as 16-bit PCM, clipping out-of-range
/// values rather than letting them wrap.
pub fn write_f32_as_s16(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let converted: Vec<i16> = samples.iter().map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16).collect();
    write_s16(&converted, sample_rate, channels)
}

/// Duration of a PCM WAV file in nanoseconds, or `None` if the bytes are not a
/// WAV this reader understands.
pub fn duration_ns(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12usize;
    let mut byte_rate: Option<u32> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            byte_rate = Some(u32::from_le_bytes(bytes[body + 8..body + 12].try_into().ok()?));
        } else if id == b"data" {
            let rate = byte_rate? as u64;
            if rate == 0 {
                return None;
            }
            let data_len = size.min(bytes.len().saturating_sub(body)) as u64;
            return Some(data_len * 1_000_000_000 / rate);
        }
        // Chunks are word aligned.
        pos = body + size + (size % 2);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_readable_header() {
        let wav = write_s16(&[0i16; 96_000], 48_000, 2);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + 96_000 * 2);
        // 96000 samples across 2 channels at 48 kHz is exactly one second.
        assert_eq!(duration_ns(&wav), Some(1_000_000_000));
    }

    #[test]
    fn float_writing_clips_rather_than_wrapping() {
        let wav = write_f32_as_s16(&[2.0, -2.0], 48_000, 1);
        let values: Vec<i16> = wav[44..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(values, vec![i16::MAX, -i16::MAX]);
    }

    #[test]
    fn rejects_things_that_are_not_wav_files() {
        assert_eq!(duration_ns(&[]), None);
        assert_eq!(duration_ns(b"not a wav file at all"), None);
        // An MP3 frame header.
        assert_eq!(duration_ns(&[0xFF, 0xFB, 0x90, 0x00]), None);
    }

    #[test]
    fn a_truncated_data_chunk_reports_only_what_is_present() {
        let mut wav = write_s16(&[0i16; 48_000], 48_000, 1);
        wav.truncate(44 + 24_000 * 2);
        assert_eq!(duration_ns(&wav), Some(500_000_000));
    }
}

//! A minimal radix-2 FFT.
//!
//! Correlating a 200 ms chirp against a 5 s recording is roughly 2 × 10^9
//! multiply-accumulates done directly, which is far too slow to run between
//! calibration repetitions. Through the frequency domain it is a few
//! milliseconds. The transform is written here rather than pulled from a crate
//! because it is eighty lines, it is one of the things this project exists to
//! teach, and it keeps the coordinator dependency-free.

use std::f64::consts::PI;

/// Smallest power of two that is at least `n`.
pub fn next_power_of_two(n: usize) -> usize {
    let mut size = 1;
    while size < n {
        size <<= 1;
    }
    size
}

/// In-place iterative Cooley-Tukey FFT.
///
/// `re` and `im` must have the same power-of-two length. `inverse` performs the
/// inverse transform, including the 1/N scaling.
pub fn fft_in_place(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    assert_eq!(n, im.len(), "real and imaginary parts must have equal length");
    assert!(n.is_power_of_two(), "FFT length must be a power of two");
    if n <= 1 {
        return;
    }

    // Bit-reversal permutation.
    let mut target = 0usize;
    for source in 1..n {
        let mut bit = n >> 1;
        while target & bit != 0 {
            target ^= bit;
            bit >>= 1;
        }
        target |= bit;
        if source < target {
            re.swap(source, target);
            im.swap(source, target);
        }
    }

    // Butterflies, doubling the transform length each pass.
    let sign = if inverse { 1.0 } else { -1.0 };
    let mut len = 2;
    while len <= n {
        let angle = sign * 2.0 * PI / len as f64;
        let (step_sin, step_cos) = angle.sin_cos();
        let mut start = 0;
        while start < n {
            let mut w_re = 1.0f64;
            let mut w_im = 0.0f64;
            for offset in 0..len / 2 {
                let a = start + offset;
                let b = a + len / 2;
                let t_re = re[b] * w_re - im[b] * w_im;
                let t_im = re[b] * w_im + im[b] * w_re;
                re[b] = re[a] - t_re;
                im[b] = im[a] - t_im;
                re[a] += t_re;
                im[a] += t_im;
                let next_re = w_re * step_cos - w_im * step_sin;
                w_im = w_re * step_sin + w_im * step_cos;
                w_re = next_re;
            }
            start += len;
        }
        len <<= 1;
    }

    if inverse {
        let scale = 1.0 / n as f64;
        for i in 0..n {
            re[i] *= scale;
            im[i] *= scale;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_signal() {
        let n = 256;
        let mut re: Vec<f64> = (0..n).map(|i| (i as f64 * 0.1).sin() + 0.3 * (i as f64 * 0.7).cos()).collect();
        let original = re.clone();
        let mut im = vec![0.0; n];

        fft_in_place(&mut re, &mut im, false);
        fft_in_place(&mut re, &mut im, true);

        for (a, b) in original.iter().zip(re.iter()) {
            assert!((a - b).abs() < 1e-9, "round trip changed the signal: {a} vs {b}");
        }
        assert!(im.iter().all(|v| v.abs() < 1e-9), "imaginary residue after round trip");
    }

    #[test]
    fn a_pure_tone_produces_one_bin() {
        let n = 64;
        let bin = 5usize;
        let mut re: Vec<f64> = (0..n).map(|i| (2.0 * PI * bin as f64 * i as f64 / n as f64).cos()).collect();
        let mut im = vec![0.0; n];
        fft_in_place(&mut re, &mut im, false);

        let magnitudes: Vec<f64> = (0..n).map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt()).collect();
        // A real cosine puts equal energy in bin and n-bin.
        assert!((magnitudes[bin] - n as f64 / 2.0).abs() < 1e-6, "bin {bin} = {}", magnitudes[bin]);
        assert!((magnitudes[n - bin] - n as f64 / 2.0).abs() < 1e-6);
        for (i, magnitude) in magnitudes.iter().enumerate() {
            if i != bin && i != n - bin {
                assert!(*magnitude < 1e-6, "bin {i} should be empty, got {magnitude}");
            }
        }
    }

    #[test]
    fn a_constant_signal_has_only_a_dc_term() {
        let n = 32;
        let mut re = vec![2.0; n];
        let mut im = vec![0.0; n];
        fft_in_place(&mut re, &mut im, false);
        assert!((re[0] - 64.0).abs() < 1e-9);
        for i in 1..n {
            assert!(re[i].abs() < 1e-9 && im[i].abs() < 1e-9);
        }
    }

    #[test]
    fn power_of_two_rounding() {
        assert_eq!(next_power_of_two(1), 1);
        assert_eq!(next_power_of_two(3), 4);
        assert_eq!(next_power_of_two(1024), 1024);
        assert_eq!(next_power_of_two(1025), 2048);
    }
}

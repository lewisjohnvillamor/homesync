//! Headless clock clients, used to run checkpoint 1 without browsers.
//!
//! Checkpoint 1 asks that independent clients agree with the coordinator's
//! clock to within a few milliseconds, and keep agreeing. Browsers are the real
//! target, but they cannot be run unattended for thirty minutes in CI. These
//! clients speak the same protocol and use the same estimator as the browser
//! (`homesync-clock`), so a regression in the clock exchange fails here first.
//!
//! What this does *not* prove: browser timer throttling, `AudioContext`
//! behaviour, Wi-Fi, or anything acoustic. Those need real devices.

use futures_util::{SinkExt, StreamExt};
use homesync_clock::ClockEstimator;
use homesync_protocol::{ClockPing, ClockQuality, Envelope, Hello, JoinRoom, Payload, Role, PROTOCOL_VERSION};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

/// Cross-client offset agreement required to pass, in milliseconds.
const MAX_PAIRWISE_DISAGREEMENT_MS: f64 = 5.0;

/// Samples taken quickly at join before settling into the steady cadence.
const WARMUP_SAMPLES: u32 = 20;
const WARMUP_INTERVAL: Duration = Duration::from_millis(100);
const STEADY_INTERVAL: Duration = Duration::from_millis(500);

/// One client's result.
#[derive(Debug)]
struct Outcome {
    index: usize,
    offset_ns: f64,
    uncertainty_ms: f64,
    rtt_median_ms: f64,
    drift_ppm: f64,
    samples: u32,
    quality: ClockQuality,
}

/// Runs `count` clients against `url` for `seconds`, then prints a report.
///
/// Returns whether the checkpoint passed.
pub async fn run(url: &str, room_code: &str, secret: &str, count: usize, seconds: u64) -> bool {
    tracing::info!(count, seconds, "starting simulated clock clients");

    // All simulated clients share one client-side clock base, so any spread in
    // their estimates is estimation error rather than a genuine difference.
    let base = Instant::now();
    let deadline = base + Duration::from_secs(seconds);

    let mut tasks = Vec::new();
    for index in 0..count {
        let url = url.to_string();
        let room_code = room_code.to_string();
        let secret = secret.to_string();
        tasks.push(tokio::spawn(async move { client(index, url, room_code, secret, base, deadline).await }));
    }

    let mut outcomes = Vec::new();
    for task in tasks {
        match task.await {
            Ok(Ok(outcome)) => outcomes.push(outcome),
            Ok(Err(error)) => tracing::error!(%error, "simulated client failed"),
            Err(error) => tracing::error!(%error, "simulated client panicked"),
        }
    }

    report(&outcomes, seconds)
}

async fn client(
    index: usize,
    url: String,
    room_code: String,
    secret: String,
    base: Instant,
    deadline: Instant,
) -> Result<Outcome, String> {
    let (socket, _) = tokio_tungstenite::connect_async(&url).await.map_err(|e| e.to_string())?;
    let (mut sink, mut stream) = socket.split();

    let send = |payload: Payload| -> Result<Message, String> {
        let envelope = Envelope { v: PROTOCOL_VERSION, request_id: None, sent_server_ns: None, payload };
        serde_json::to_string(&envelope).map(|t| Message::Text(t.into())).map_err(|e| e.to_string())
    };

    sink.send(send(Payload::Hello(Hello {
        client_version: concat!("homesync-sim/", env!("CARGO_PKG_VERSION")).to_string(),
        user_agent: "simulated".to_string(),
        device_id: None,
    }))?)
    .await
    .map_err(|e| e.to_string())?;

    sink.send(send(Payload::JoinRoom(JoinRoom {
        room_code,
        secret,
        name: format!("sim-{index}"),
        // Controller, so simulated clients never satisfy or block the
        // readiness barrier that real receivers are subject to.
        role: Role::Controller,
    }))?)
    .await
    .map_err(|e| e.to_string())?;

    let mut estimator = ClockEstimator::new();
    let mut seq = 0u64;
    let mut ticker = tokio::time::interval(WARMUP_INTERVAL);

    loop {
        if Instant::now() >= deadline {
            break;
        }
        tokio::select! {
            _ = ticker.tick() => {
                if seq == u64::from(WARMUP_SAMPLES) {
                    ticker = tokio::time::interval(STEADY_INTERVAL);
                }
                let t0 = base.elapsed().as_nanos() as f64;
                sink.send(send(Payload::ClockPing(ClockPing { t0, seq }))?).await.map_err(|e| e.to_string())?;
                seq += 1;

                if seq.is_multiple_of(4) && estimator.has_estimate() {
                    sink.send(send(Payload::ClockReport(estimator.report()))?).await.map_err(|e| e.to_string())?;
                }
            }
            message = stream.next() => {
                let t3 = base.elapsed().as_nanos() as f64;
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(envelope) = serde_json::from_str::<Envelope>(&text) {
                            if let Payload::ClockPong(pong) = envelope.payload {
                                estimator.push(pong.t0, pong.t1 as f64, pong.t2 as f64, t3);
                            }
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(error.to_string()),
                    None => return Err("coordinator closed the connection".to_string()),
                }
            }
        }
    }

    let report = estimator.report();
    Ok(Outcome {
        index,
        offset_ns: estimator.offset_ns(),
        uncertainty_ms: report.offset_uncertainty_ms,
        rtt_median_ms: report.rtt_median_ms,
        drift_ppm: report.drift_ppm,
        samples: report.samples,
        quality: report.quality,
    })
}

/// Prints the checkpoint-1 table and returns whether it passed.
fn report(outcomes: &[Outcome], seconds: u64) -> bool {
    println!();
    println!("  Checkpoint 1 — clock agreement over {seconds}s");
    println!("  ------------------------------------------------------------------");
    println!("  {:<8} {:>12} {:>12} {:>10} {:>10}  quality", "client", "offset ms", "uncert ms", "rtt ms", "drift ppm");
    for outcome in outcomes {
        println!(
            "  {:<8} {:>12.3} {:>12.3} {:>10.3} {:>10.1}  {:?} ({} samples)",
            format!("sim-{}", outcome.index),
            outcome.offset_ns / 1e6,
            outcome.uncertainty_ms,
            outcome.rtt_median_ms,
            outcome.drift_ppm,
            outcome.quality,
            outcome.samples,
        );
    }

    if outcomes.len() < 2 {
        println!("  ------------------------------------------------------------------");
        println!("  Need at least two clients to compare. Re-run with --simulate 2.");
        println!();
        return false;
    }

    let offsets: Vec<f64> = outcomes.iter().map(|o| o.offset_ns).collect();
    let lo = offsets.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = offsets.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let spread_ms = (hi - lo) / 1e6;
    let all_stable = outcomes.iter().all(|o| o.quality == ClockQuality::Stable);
    let passed = all_stable && spread_ms < MAX_PAIRWISE_DISAGREEMENT_MS;

    println!("  ------------------------------------------------------------------");
    println!("  Worst pairwise disagreement : {spread_ms:.3} ms (limit {MAX_PAIRWISE_DISAGREEMENT_MS:.1} ms)");
    println!("  All clocks stable           : {all_stable}");
    println!("  Checkpoint 1                : {}", if passed { "PASS" } else { "FAIL" });
    println!();
    println!("  Note: these clients share this machine's clock and loopback network.");
    println!("  A pass here proves the exchange and estimator are correct, not that");
    println!("  real devices over Wi-Fi will agree. Repeat with browsers on the LAN.");
    println!();

    passed
}

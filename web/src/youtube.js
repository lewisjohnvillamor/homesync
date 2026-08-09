/**
 * YouTube Together (source mode B).
 *
 * Every device runs its own official IFrame player; HomeSync distributes only
 * a position and an instant. No YouTube audio or video passes through the
 * coordinator.
 *
 * This mode is best-effort by construction, and it is worth being clear about
 * why. The IFrame API offers `seekTo` and `playVideo`, not sample-accurate
 * scheduling: the gap between calling `playVideo()` and sound emerging is
 * hundreds of milliseconds and varies by device, network and video. HomeSync
 * measures that gap per device and calls `playVideo()` early by the learned
 * amount, which converges on tens of milliseconds — good enough to watch
 * together, not good enough to call synchronised playback.
 *
 * Ads are the hard limit. They are inserted per viewer, so two devices can be
 * watching genuinely different content, and no amount of scheduling fixes it.
 */

/** Player states, from the IFrame API's numeric codes. */
const STATE_NAMES = {
  '-1': 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued',
};

/** How close to the target a seek must land before we stop re-seeking. */
const SEEK_TOLERANCE_S = 0.15;

let apiPromise = null;

/** Loads the IFrame API once per page. */
function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    // The coordinator is served over plain HTTP on a LAN address while this
    // script comes from YouTube; if the network blocks it, say so rather than
    // leaving the user with an empty box.
    script.onerror = () => reject(new Error('could not load the YouTube IFrame API'));
    document.head.append(script);
  });
  return apiPromise;
}

export class YoutubePlayer {
  /**
   * @param {HTMLElement} container element the iframe replaces
   * @param {import('./clock.js').ClockEstimator} clock
   */
  constructor(container, clock) {
    this.container = container;
    this.clock = clock;
    this.player = null;
    this.videoId = null;
    this.ready = false;
    /** Rendezvous epoch currently being served. */
    this.epoch = -1;
    /** Timer for the scheduled `playVideo()` call. */
    this.startTimer = null;
    /** Coordinator time we asked the player to start at. */
    this.pendingStartNs = null;
    /** Coordinator time we actually called `playVideo()`. */
    this.playCalledNs = null;
    /** Measured start latency awaiting report, in milliseconds. */
    this.observedStartLatencyMs = null;
    /** @type {((message: string) => void)|null} */
    this.onLog = null;
  }

  /** Loads (or reloads) a video, resolving once the player reports ready. */
  async load(videoId) {
    if (this.videoId === videoId && this.player) return;
    const YT = await loadApi();
    this.videoId = videoId;

    if (this.player) {
      this.ready = false;
      this.player.cueVideoById(videoId);
      return;
    }

    await new Promise((resolve) => {
      this.player = new YT.Player(this.container, {
        videoId,
        // Cue rather than autoplay: playback must begin at the rendezvous
        // instant, not whenever the iframe finishes loading.
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => {
            this.ready = true;
            resolve();
          },
          onError: (event) => {
            this.#log(`YouTube player error ${event.data} (the video may not allow embedding)`);
            resolve();
          },
        },
      });
    });
  }

  /** Current state, in the shape of the protocol's `youtube_state` payload. */
  state() {
    const player = this.player;
    if (!player || !this.ready || typeof player.getPlayerState !== 'function') {
      return {
        video_id: this.videoId ?? '',
        player_state: 'unstarted',
        current_time_s: 0,
        duration_s: 0,
        buffered_fraction: 0,
        ready: false,
      };
    }
    const report = {
      video_id: this.videoId ?? '',
      player_state: STATE_NAMES[String(player.getPlayerState())] ?? 'unstarted',
      current_time_s: player.getCurrentTime() || 0,
      duration_s: player.getDuration() || 0,
      buffered_fraction: player.getVideoLoadedFraction() || 0,
      ready: true,
    };
    // A measured start latency is reported exactly once, so the coordinator's
    // moving average is not fed the same observation repeatedly.
    if (this.observedStartLatencyMs != null) {
      report.observed_start_latency_ms = this.observedStartLatencyMs;
      this.observedStartLatencyMs = null;
    }
    return report;
  }

  /**
   * Applies a rendezvous: seek to the target and start early by this device's
   * learned latency so sound emerges at the appointed instant.
   */
  async rendezvous(message) {
    if (!this.player || message.epoch === this.epoch) return;
    this.epoch = message.epoch;
    this.#cancelPending();

    await this.load(message.video_id);
    if (!this.ready) return;

    const startNs = message.start_server_ns;
    const leadMs = Math.max(0, message.start_latency_ms || 0);

    // Position to seek to: the target, plus however long we will still be
    // waiting after the seek completes.
    const nowNs = this.clock.serverNow();
    const untilStartS = Math.max(0, (startNs - nowNs) / 1e9);
    const seekTarget = message.target_position_s;

    this.player.pauseVideo();
    this.player.seekTo(seekTarget, true);

    const callAtNs = startNs - leadMs * 1e6;
    const delayMs = (callAtNs - this.clock.serverNow()) / 1e6;
    this.pendingStartNs = startNs;

    if (delayMs <= 0) {
      // Already past the moment to call play: start now and seek forward by
      // however much of the timeline has elapsed, rather than starting late.
      const behindS = -delayMs / 1000 + leadMs / 1000;
      this.player.seekTo(seekTarget + Math.max(0, behindS), true);
      this.#play();
      return;
    }

    this.#log(
      `YouTube: seeking to ${seekTarget.toFixed(2)}s, starting in ${(delayMs / 1000).toFixed(2)}s ` +
        `(${leadMs.toFixed(0)} ms early for this device)`,
    );
    this.startTimer = setTimeout(() => this.#play(), delayMs);
    void untilStartS;
  }

  #play() {
    this.startTimer = null;
    if (!this.player) return;
    this.playCalledNs = this.clock.serverNow();
    this.player.playVideo();
    this.#watchForStart();
  }

  /**
   * Measures how long the player actually took to begin, so the coordinator
   * can start this device that much earlier next time.
   */
  #watchForStart() {
    const startedAt = this.playCalledNs;
    let previousTime = this.player.getCurrentTime?.() ?? 0;
    let polls = 0;
    const poll = () => {
      if (!this.player || this.playCalledNs !== startedAt) return;
      const state = this.player.getPlayerState?.();
      const time = this.player.getCurrentTime?.() ?? 0;
      // "Playing" is reported before sound emerges; a position that has
      // actually advanced is the honest signal.
      if (state === 1 && time > previousTime + 0.005) {
        this.observedStartLatencyMs = (this.clock.serverNow() - startedAt) / 1e6;
        return;
      }
      previousTime = Math.max(previousTime, time);
      polls += 1;
      if (polls < 200) setTimeout(poll, 25);
    };
    setTimeout(poll, 25);
  }

  #cancelPending() {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  /** Pauses the player and abandons any pending scheduled start. */
  pause() {
    this.#cancelPending();
    this.epoch = -1;
    this.player?.pauseVideo?.();
  }

  /** Destroys the player. */
  destroy() {
    this.#cancelPending();
    this.player?.destroy?.();
    this.player = null;
    this.ready = false;
    this.videoId = null;
    this.epoch = -1;
  }

  #log(message) {
    if (this.onLog) this.onLog(message);
  }
}

/**
 * Extracts a video id from whatever the user pasted: a bare id, a watch URL,
 * a short youtu.be link or an embed URL.
 */
export function parseVideoId(input) {
  const text = (input ?? '').trim();
  if (!text) return null;
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    // Only YouTube's own hosts. A well-formed id sitting in some other site's
    // query string is not a YouTube video, and loading it would give every
    // device in the room an unrelated video or an error.
    const host = url.hostname.replace(/^www\.|^m\./, '');
    if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') {
      return null;
    }
    const fromQuery = url.searchParams.get('v');
    if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /^[\w-]{11}$/.test(last)) return last;
  } catch {
    // Not a URL; fall through.
  }
  return null;
}

export { SEEK_TOLERANCE_S };

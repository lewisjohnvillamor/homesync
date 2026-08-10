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

/**
 * Works out where to seek and when to call `playVideo()` for one rendezvous.
 *
 * Pure, because the arithmetic is the whole of the mode and getting it wrong
 * is inaudible in code review but not in a room.
 *
 * `leadMs` is how much earlier than the meeting instant this device must call
 * `playVideo()`: its learned player start latency plus whatever compensation
 * the room holds for it. Negative is meaningful — a device that emits sound
 * early is told to call play *late*.
 *
 * When the moment to call play has already passed, the seek target moves
 * forward by everything that will have elapsed by the time sound emerges:
 * the lateness *and* the start latency still to come. Both are already
 * carried by `delayMs`, which is why the correction is exactly `-delayMs` and
 * adding the lead a second time would land the device a start-latency ahead
 * of everyone else.
 */
export function rendezvousPlan({ startNs, nowNs, leadMs, targetPositionS }) {
  const delayMs = (startNs - leadMs * 1e6 - nowNs) / 1e6;
  if (delayMs > 0) {
    return { immediate: false, delayMs, seekTargetS: targetPositionS };
  }
  return { immediate: true, delayMs, seekTargetS: targetPositionS + Math.max(0, -delayMs / 1000) };
}

/**
 * IFrame API error codes, in language that says what to do about it.
 *
 * 101 and 150 are the same condition reported two ways, and they are the
 * common one: the video's owner has disallowed playback outside youtube.com.
 * Most major-label music videos are published that way. Nothing in HomeSync
 * can change it — the refusal happens inside YouTube's own player — so the
 * only useful response is to say so plainly and let someone pick another
 * video.
 */
const ERROR_MESSAGES = {
  2: 'That video id is not valid.',
  5: 'The YouTube player could not play that video in this browser.',
  100: 'That video does not exist, or it is private.',
  101: 'That video cannot be embedded — its owner only allows playback on YouTube itself. Pick a different video.',
  150: 'That video cannot be embedded — its owner only allows playback on YouTube itself. Pick a different video.',
};

/** Whether an error means the video will never play here, whatever we do. */
export function isUnembeddable(code) {
  return code === 101 || code === 150 || code === 100;
}

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
    /** Resolves when the player's methods exist. Also guards construction. */
    this.readyPromise = null;
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
    /** Most recent IFrame API error code, if any. */
    this.lastError = null;
    /** @type {((message: string) => void)|null} */
    this.onLog = null;
    /** Called when the video will never play here, whatever we do. */
    this.onUnplayable = null;
  }

  /**
   * Loads (or reloads) a video, resolving once the player is usable.
   *
   * `new YT.Player()` returns an object immediately, but its methods —
   * `cueVideoById`, `seekTo`, `playVideo` — do not exist until the player
   * reports ready. Calling one before then throws
   * "cueVideoById is not a function", which is why every path here waits on
   * the same readiness promise rather than on the object merely existing.
   */
  async load(videoId) {
    if (this.videoId === videoId && this.player && this.ready) return;
    this.lastError = null;
    const YT = await loadApi();

    if (this.readyPromise) {
      await this.readyPromise;
      if (this.videoId === videoId) return;
      if (typeof this.player?.cueVideoById !== 'function') {
        this.#log('the YouTube player never became ready; reload the page to try again');
        return;
      }
      this.videoId = videoId;
      // Readiness is not cleared here: onReady fires once, at construction,
      // and cueing another video does not repeat it. Clearing it would leave
      // the player permanently reported as unready.
      this.player.cueVideoById(videoId);
      return;
    }

    this.videoId = videoId;
    this.readyPromise = new Promise((resolve) => {
      this.player = new YT.Player(this.container, {
        videoId,
        // Cue rather than autoplay: playback must begin at the rendezvous
        // instant, not whenever the iframe finishes loading.
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          rel: 0,
          playsinline: 1,
          // YouTube checks these against the page. Without a matching origin
          // the API is refused from a LAN address, which looks identical to
          // the video being unavailable.
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.ready = true;
            resolve();
          },
          onError: (event) => {
            this.lastError = event.data;
            this.#log(ERROR_MESSAGES[event.data] ?? `The YouTube player reported error ${event.data}.`);
            if (this.onUnplayable && isUnembeddable(event.data)) {
              this.onUnplayable(ERROR_MESSAGES[event.data] ?? `error ${event.data}`);
            }
            resolve();
          },
        },
      });
    });
    await this.readyPromise;
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

    if (typeof this.player.seekTo !== 'function') {
      this.#log('the YouTube player is not ready to seek yet; skipping this rendezvous');
      return;
    }

    const startNs = message.start_server_ns;
    const leadMs = message.start_latency_ms || 0;
    const plan = rendezvousPlan({
      startNs,
      nowNs: this.clock.serverNow(),
      leadMs,
      targetPositionS: message.target_position_s,
    });

    this.player.pauseVideo();
    this.player.seekTo(plan.seekTargetS, true);
    this.pendingStartNs = startNs;

    if (plan.immediate) {
      // Already past the moment to call play: start now from a target that
      // accounts for the lateness, rather than starting late.
      this.#play();
      return;
    }

    this.#log(
      `YouTube: seeking to ${plan.seekTargetS.toFixed(2)}s, starting in ${(plan.delayMs / 1000).toFixed(2)}s ` +
        `(${leadMs.toFixed(0)} ms early for this device)`,
    );
    this.startTimer = setTimeout(() => this.#play(), plan.delayMs);
  }

  /**
   * Applies volume and mute to the iframe player.
   *
   * The YouTube player's audio never enters our audio graph, so the gain node
   * that serves every other mode cannot reach it. Without this the volume
   * slider and the mute box were inert in YouTube mode.
   */
  setVolume(volume, muted) {
    if (typeof this.player?.setVolume !== 'function') return;
    this.player.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100));
    if (muted) this.player.mute?.();
    else this.player.unMute?.();
  }

  #play() {
    this.startTimer = null;
    if (typeof this.player?.playVideo !== 'function') return;
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
    // Optional call: the methods do not exist before the player is ready.
    this.player?.pauseVideo?.();
  }

  /** Destroys the player. */
  destroy() {
    this.#cancelPending();
    this.player?.destroy?.();
    this.player = null;
    this.ready = false;
    this.videoId = null;
    this.readyPromise = null;
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

import { SyncEngine, type PlaybackState } from "@sync/shared";
import { DriftCorrector } from "./drift-corrector";

export type MediaPort = {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended?: boolean;
  seeking?: boolean;
  readyState?: number;
  playbackRate: number;
  preservesPitch?: boolean;
  pause: () => void;
  play: () => Promise<void>;
};
export type SyncMetrics = {
  expected: number;
  actual: number;
  driftMs: number | null;
  rate: number;
  correction: "none" | "rate" | "seek";
  phase: "idle" | "waiting" | "scheduled" | "playing" | "paused" | "ended";
  startInMs: number;
};
type TimerPort = {
  set: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
};

export class PlaybackScheduler {
  metrics: SyncMetrics | null = null;
  automaticSeeks = 0;
  commandSeeks = 0;
  private state: PlaybackState | null = null;
  private duration = 0;
  private ready = false;
  private active = false;
  private pending = false;
  private force = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastCorrectionAt = -Infinity;
  private warmingUntil = 0;
  private seekSettlingUntil = 0;
  private wasSeeking = false;
  private largeDriftSince: number | null = null;
  private driftDirection = 0;
  private lastAutomaticSeekAt = -Infinity;
  private epoch = 0;
  private readonly engine = new SyncEngine();
  constructor(
    private readonly audio: MediaPort,
    private readonly now: () => number,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly corrector = new DriftCorrector(),
    private readonly timers: TimerPort = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (timer) => clearTimeout(timer),
    },
  ) {
    // Adaptive correction uses resampling for shifts capped at 1%. Native
    // Apple output keeps normal speed and the browser's pitch-preserving path.
    if (typeof audio.preservesPitch === "boolean")
      audio.preservesPitch = corrector.maxRateDelta === 0;
  }

  update(
    state: PlaybackState,
    duration: number,
    ready: boolean,
    active: boolean,
  ): boolean {
    if (this.disposed) return false;
    if (
      this.state?.roomId === state.roomId &&
      state.revision < this.state.revision
    )
      return false;
    const previous = this.state;
    const changed =
      (active && !this.active) ||
      !previous ||
      previous.roomId !== state.roomId ||
      previous.trackRevision !== state.trackRevision ||
      previous.position !== state.position ||
      previous.startedAt !== state.startedAt ||
      previous.playbackState !== state.playbackState;
    if (changed) {
      this.cancel();
      this.force = true;
      this.epoch++;
      this.warmingUntil = 0;
      this.largeDriftSince = null;
    }
    this.state = state;
    this.duration = duration;
    this.ready = ready;
    this.active = active;
    this.metrics = this.tick();
    return true;
  }
  tick(): SyncMetrics {
    const state = this.state;
    const now = this.now();
    const expected = state
      ? this.engine.positionAt(state, now, this.duration)
      : 0;
    const base: SyncMetrics = {
      expected,
      actual: this.audio.currentTime,
      driftMs: null,
      rate: 1,
      correction: "none",
      phase: "idle",
      startInMs: 0,
    };
    if (!state || this.disposed) return base;
    // Seeking is asynchronous. Media events can re-enter tick before the
    // decoder has rendered the requested position; never chase that cursor.
    if (this.wasSeeking && !this.audio.seeking)
      this.seekSettlingUntil = now + 1500;
    this.wasSeeking = !!this.audio.seeking;
    const ended = expected >= this.duration ||
      (this.audio.ended && expected >= this.duration - 0.08);
    if (ended) {
      // The authoritative position stays at the end, while the decoder may
      // preload position 0 for replay. Do not keep seeking it back to the tail.
      this.stop();
      return { ...base, phase: "ended" };
    }
    if (!this.ready || !this.active) {
      this.stop();
      return { ...base, phase: "waiting" };
    }
    const command = this.force;
    const stableDecoder = !this.audio.seeking && !this.pending &&
      now >= this.seekSettlingUntil && (this.audio.readyState ?? 4) >= 3;
    const forced = command || (stableDecoder && state.playbackState === "paused" &&
      Math.abs(this.audio.currentTime - expected) > 0.03);
    const warming = state.playbackState === "playing" && now < this.warmingUntil;
    const drift = this.audio.currentTime - expected;
    const largeDrift = Math.abs(drift) >= this.corrector.seekThreshold;
    if (!stableDecoder || warming || !largeDrift) this.largeDriftSince = null;
    else if (this.largeDriftSince === null || this.driftDirection !== Math.sign(drift)) {
      this.largeDriftSince = now;
      this.driftDirection = Math.sign(drift);
    }
    // Startup/output latency and a transient stalled cursor are not SEEK
    // commands. Confirm persistent error, and bound disruptive corrections.
    const automaticSeek = this.largeDriftSince !== null &&
      now - this.largeDriftSince >= 800 && now - this.lastAutomaticSeekAt >= 5000;
    const canCorrect = forced || (stableDecoder && !warming &&
      (largeDrift ? automaticSeek : now - this.lastCorrectionAt >= 200));
    const correction = canCorrect
      ? this.corrector.correct(
          this.audio.currentTime,
          expected,
          this.audio.playbackRate,
          forced,
        )
      : {
          kind: "none" as const,
          rate: warming ? 1 : this.audio.playbackRate,
          position: this.audio.currentTime,
        };
    if (canCorrect) this.lastCorrectionAt = now;
    this.force = false;
    if (
      correction.kind === "seek" &&
      Math.abs(this.audio.currentTime - correction.position) > 0.001
    ) {
      // Set guards before the setter can dispatch/re-enter through media events.
      this.seekSettlingUntil = now + 1500;
      this.largeDriftSince = null;
      if (command) this.commandSeeks++;
      else { this.automaticSeeks++; this.lastAutomaticSeekAt = now; }
      this.audio.currentTime = correction.position;
    }
    this.setRate(correction.rate);
    const metrics = {
      ...base,
      // Report the sampled error, not the requested position after a seek.
      // The native decoder has not necessarily reached that position yet.
      driftMs: drift * 1000,
      correction: correction.kind,
      rate: correction.rate,
    };
    if (state.playbackState === "paused") {
      this.stop();
      return { ...metrics, rate: 1, phase: "paused" };
    }
    if (!this.engine.hasStarted(state, now)) {
      if (!this.audio.paused) this.audio.pause();
      this.setRate(1);
      if (!this.timer)
        this.timer = this.timers.set(
          () => {
            this.timer = null;
            this.metrics = this.tick();
          },
          Math.max(1, Math.ceil(state.startedAt! - now)),
        );
      return {
        ...metrics,
        rate: 1,
        phase: "scheduled",
        startInMs: state.startedAt! - now,
      };
    }
    this.cancel();
    if (this.audio.paused && !this.pending) {
      this.pending = true;
      const epoch = this.epoch;
      this.warmingUntil = now + 1500;
      this.setRate(1);
      void this.audio
        .play()
        .then(() => {
          // A retired controller must never pause an element reused by a new track.
          if (this.disposed) return;
          if (
            !this.ready ||
            !this.active ||
            this.state?.playbackState !== "playing" ||
            !this.engine.hasStarted(this.state, this.now())
          )
            this.audio.pause();
          else if (epoch === this.epoch) this.warmingUntil = this.now() + 1500;
        })
        .catch((error) => {
          if (!this.disposed && epoch === this.epoch) this.onError(error);
        })
        .finally(() => {
          this.pending = false;
        });
    }
    return { ...metrics, phase: "playing" };
  }
  private cancel() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
  private stop() {
    this.cancel();
    if (!this.audio.paused) this.audio.pause();
    this.setRate(1);
    this.warmingUntil = 0;
  }
  private setRate(rate: number) {
    if (this.audio.playbackRate !== rate) this.audio.playbackRate = rate;
  }
  destroy() {
    this.disposed = true;
    this.stop();
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncEngine, roomSchema, type PlaybackState } from "@sync/shared";
import { ClockOffsetEstimator } from "./clock-offset-estimator";
import { DriftCorrector } from "./drift-corrector";
import { PlaybackScheduler, type MediaPort } from "./playback-scheduler";
import { applyPlaybackState, applyRoomSnapshot } from "./apply-playback";

function sample(mono: number, offset = 5000, delay = 10, wall = 0) {
  return {
    t0: mono + wall,
    t1: mono + wall + offset + delay,
    t2: mono + wall + offset + delay + 5,
    t3: mono + wall + 2 * delay + 5,
    monoSent: mono,
    monoReceived: mono + 2 * delay + 5,
  };
}
describe("ClockOffsetEstimator", () => {
  it("requires multiple samples, estimates processing-adjusted RTT and prefers low delay", () => {
    const clock = new ClockOffsetEstimator();
    clock.add(sample(0));
    expect(clock.estimate(25)).toBeNull();
    clock.add(sample(100));
    clock.add(sample(200));
    clock.add(sample(300, 5800, 500));
    const estimate = clock.estimate(1400)!;
    expect(estimate.offsetMs).toBeCloseTo(5000);
    expect(estimate.rttMs).toBe(20);
    expect(estimate.samples).toBe(4);
    expect(clock.serverNow(1500)).toBeCloseTo(6500);
  });
  it("projects through monotonic time, expires samples and rejects clock jumps and malformed delays", () => {
    const clock = new ClockOffsetEstimator();
    for (const mono of [0, 100, 200])
      clock.add(sample(mono, -3000, 10, 10_000));
    expect(clock.serverNow(300)).toBeCloseTo(7300);
    expect(clock.estimate(15_225)).toBeNull();
    expect(clock.add({ ...sample(400), t2: -1 })).toBe(false);
    expect(clock.add(sample(400, 0, 1100))).toBe(false);
    expect(clock.add({ ...sample(500), t3: 4000 })).toBe(false);
    expect(clock.estimate(4000)).toBeNull();
  });
  it("resets old offsets when the wall clock changes between exchanges", () => {
    const clock = new ClockOffsetEstimator();
    for (const mono of [0, 100, 200]) clock.add(sample(mono));
    clock.add(sample(300, -5000, 10, 10_000));
    expect(clock.estimate(325)).toBeNull();
    clock.add(sample(400, -5000, 10, 10_000));
    clock.add(sample(500, -5000, 10, 10_000));
    expect(clock.serverNow(600)).toBeCloseTo(5600);
  });
});
describe("DriftCorrector", () => {
  const corrector = new DriftCorrector();
  it("leaves small errors untouched and restores normal rate", () => {
    expect(corrector.correct(10.02, 10, 1.02)).toMatchObject({
      kind: "none",
      position: 10.02,
      rate: 1,
    });
  });
  it("gradually speeds up a lagging client and slows an ahead client", () => {
    expect(corrector.correct(9.8, 10)).toMatchObject({
      kind: "rate",
      rate: 1.002,
    });
    expect(corrector.correct(10.2, 10)).toMatchObject({
      kind: "rate",
      rate: 0.998,
    });
    expect(corrector.correct(9.5, 10, 1.024).rate).toBe(1.01);
  });
  it("seeks only large errors or explicit timeline changes", () => {
    expect(corrector.correct(8, 10)).toMatchObject({
      kind: "seek",
      position: 10,
      rate: 1,
    });
    expect(corrector.correct(9.9, 10, 1, true).kind).toBe("seek");
  });
  it("bounds temporary pitch/speed changes to one percent in either direction", () => {
    for (const error of [-0.5, -0.2, 0.2, 0.5]) {
      let rate = 1;
      for (let i = 0; i < 20; i++) rate = corrector.correct(10 + error, 10, rate).rate;
      expect(rate).toBeGreaterThanOrEqual(0.99);
      expect(rate).toBeLessThanOrEqual(1.01);
      expect(Math.sign(rate - 1)).toBe(-Math.sign(error));
    }
  });
});
class Audio implements MediaPort {
  currentTime = 0;
  duration = 24;
  paused = true;
  playbackRate = 1;
  calls = 0;
  pause() {
    this.paused = true;
  }
  play() {
    this.calls++;
    this.paused = false;
    return Promise.resolve();
  }
}
const state = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  roomId: "abcdefghij",
  trackId: "orbit",
  trackRevision: 2,
  revision: 5,
  position: 0,
  startedAt: 1750,
  playbackState: "playing",
  serverTime: 1000,
  ...overrides,
});
afterEach(() => vi.useRealTimers());
describe("PlaybackScheduler and SyncEngine", () => {
  it("uses resampling rather than pitch-preserving time stretch for tiny speed corrections", () => {
    const audio = Object.assign(new Audio(), { preservesPitch: true });
    const scheduler = new PlaybackScheduler(audio, () => 1750);
    expect(audio.preservesPitch).toBe(false);
    scheduler.destroy();
  });
  it("does not write speed or seek an already aligned media element on every timer/snapshot", () => {
    const audio = new Audio();
    let time = 0, rate = 1;
    const seek = vi.fn((value: number) => { time = value; });
    const setRate = vi.fn((value: number) => { rate = value; });
    Object.defineProperties(audio, {
      currentTime: { get: () => time, set: seek },
      playbackRate: { get: () => rate, set: setRate },
    });
    const scheduler = new PlaybackScheduler(audio, () => 1750);
    scheduler.update(state(), 24, true, true);
    for (let i = 0; i < 20; i++) scheduler.update(state({ revision: 6 + i }), 24, true, true);
    expect(seek).not.toHaveBeenCalled();
    expect(setRate).not.toHaveBeenCalled();
    scheduler.destroy();
    expect(setRate).not.toHaveBeenCalled();
  });
  it("does not accelerate the rate ramp when media events and snapshots arrive in a burst", async () => {
    const audio = new Audio();
    let now = 1750;
    const scheduler = new PlaybackScheduler(audio, () => now);
    scheduler.update(state(), 24, true, true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    now += 1800;
    audio.currentTime = 2; // 200 ms ahead, after the initial decoder settling period.
    scheduler.tick();
    const rate = audio.playbackRate;
    expect(rate).toBeLessThan(1);
    for (let i = 0; i < 10; i++) {
      now += 1;
      audio.currentTime += rate / 1000;
      scheduler.update(state({ revision: 6 + i }), 24, true, true);
      expect(audio.playbackRate).toBe(rate);
    }
    now += 200;
    audio.currentTime += rate * 0.2;
    scheduler.tick();
    expect(audio.playbackRate).toBeLessThan(rate);
    // A user Seek must still apply immediately inside the rate update interval.
    scheduler.update(state({ revision: 20, position: 8, startedAt: now }), 24, true, true);
    expect(audio.currentTime).toBe(8);
    expect(audio.playbackRate).toBe(1);
    scheduler.destroy();
  });
  it("two clients receiving PLAY at different delays wait for the same server time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const first = new Audio(),
      second = new Audio();
    const a = new PlaybackScheduler(first, Date.now),
      b = new PlaybackScheduler(second, Date.now);
    a.update(state(), 24, true, true);
    await vi.advanceTimersByTimeAsync(400);
    b.update(state(), 24, true, true);
    expect(first.calls + second.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(349);
    expect(first.calls + second.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect([first.paused, second.paused]).toEqual([false, false]);
    expect([first.currentTime, second.currentTime]).toEqual([0, 0]);
    a.destroy();
    b.destroy();
  });
  it("PAUSE cancels a pending start, SEEK applies to both and stale PLAY cannot restart audio", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const ports = [new Audio(), new Audio()];
    const clients = ports.map((p) => new PlaybackScheduler(p, Date.now));
    clients.forEach((s) => s.update(state(), 24, true, true));
    clients.forEach((s) =>
      s.update(
        state({
          revision: 6,
          playbackState: "paused",
          position: 8,
          startedAt: null,
        }),
        24,
        true,
        true,
      ),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(ports.map((p) => p.calls)).toEqual([0, 0]);
    expect(ports.map((p) => p.currentTime)).toEqual([8, 8]);
    clients.forEach((s) =>
      expect(s.update(state(), 24, true, true)).toBe(false),
    );
    clients.forEach((s) =>
      s.update(
        state({ revision: 7, position: 12, startedAt: 2000 }),
        24,
        true,
        true,
      ),
    );
    expect(ports.map((p) => p.currentTime)).toEqual([12, 12]);
    clients.forEach((s) => s.destroy());
  });
  it("late delivery and reconnect catch up; disconnect stops playback and track changes reset rate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3000);
    const audio = new Audio();
    const scheduler = new PlaybackScheduler(audio, Date.now);
    scheduler.update(state(), 24, false, true);
    expect(audio.paused).toBe(true);
    scheduler.update(state(), 24, true, true);
    expect(audio.currentTime).toBe(1.25);
    scheduler.update(state(), 24, true, false);
    expect(audio.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.update(state({ revision: 6 }), 24, true, true);
    expect(audio.currentTime).toBe(2.25);
    audio.playbackRate = 1.02;
    scheduler.update(
      state({
        revision: 7,
        trackRevision: 7,
        trackId: "soft-focus",
        playbackState: "paused",
        startedAt: null,
      }),
      24,
      true,
      true,
    );
    expect(audio.currentTime).toBe(0);
    expect(audio.playbackRate).toBe(1);
    expect(audio.paused).toBe(true);
    scheduler.destroy();
  });
  it("corrects drift in tiers, reports current timeline error and handles the end", async () => {
    const audio = new Audio();
    let now = 1750;
    const scheduler = new PlaybackScheduler(audio, () => now);
    scheduler.update(state(), 24, true, true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    now += 1800;
    audio.currentTime = 2;
    expect(scheduler.tick()).toMatchObject({
      correction: "rate",
      rate: 0.998,
    });
    expect(scheduler.tick().driftMs).toBeCloseTo(200);
    audio.currentTime = 4;
    expect(scheduler.tick().correction).toBe("none");
    now += 800;
    expect(scheduler.tick()).toMatchObject({
      correction: "seek",
      actual: 4,
      driftMs: 1400,
    });
    expect(audio.currentTime).toBe(2.6);
    now = 30_000;
    expect(scheduler.tick()).toMatchObject({ phase: "ended", expected: 24 });
    expect(audio.paused).toBe(true);
    expect(audio.playbackRate).toBe(1);
    scheduler.destroy();
  });
  it("keeps normal speed while the decoder settles, without delaying an explicit seek", async () => {
    const audio = new Audio();
    let now = 1750;
    const scheduler = new PlaybackScheduler(audio, () => now);
    scheduler.update(state(), 24, true, true);
    await Promise.resolve();
    for (const elapsed of [100, 500, 1000, 1400]) {
      now = 1750 + elapsed;
      audio.currentTime = elapsed / 1000 + 0.2;
      expect(scheduler.tick().rate).toBe(1);
    }
    scheduler.update(state({ revision: 6, position: 8, startedAt: now }), 24, true, true);
    expect(audio.currentTime).toBe(8);
    scheduler.destroy();
  });
  it("does not turn native startup/output latency into a repeating seek loop", async () => {
    const audio = Object.assign(new Audio(), { seeking: false, readyState: 4 });
    let now = 1750, cursor = 0;
    const seek = vi.fn((position: number) => { cursor = position; });
    Object.defineProperty(audio, "currentTime", { get: () => cursor, set: seek });
    const scheduler = new PlaybackScheduler(audio, () => now, undefined, new DriftCorrector(0.04, 1, 0));
    scheduler.update(state(), 24, true, true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    for (let elapsed = 100; elapsed <= 12_000; elapsed += 100) {
      now = 1750 + elapsed;
      cursor = Math.max(0, elapsed / 1000 - 0.45);
      scheduler.update(state({ revision: 6 + elapsed / 100 }), 24, true, true);
    }
    expect(seek).not.toHaveBeenCalled();
    expect(audio.playbackRate).toBe(1);
    expect(scheduler.metrics?.driftMs).toBeCloseTo(-450);
    scheduler.destroy();
  });
  it("waits for an asynchronous seek and decoder settling instead of retargeting media events", async () => {
    const audio = Object.assign(new Audio(), { seeking: false, readyState: 4 });
    let now = 1750, cursor = 0;
    const seek = vi.fn(() => { audio.seeking = true; });
    Object.defineProperty(audio, "currentTime", { get: () => cursor, set: seek });
    const scheduler = new PlaybackScheduler(audio, () => now);
    scheduler.update(state(), 24, true, true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    now = 4000; cursor = 0.8;
    scheduler.tick();
    now += 800; const measured = scheduler.tick();
    expect(seek).toHaveBeenCalledOnce();
    expect(measured.actual).toBe(0.8);
    for (let i = 0; i < 20; i++) { now += 50; scheduler.tick(); }
    expect(seek).toHaveBeenCalledOnce();
    // A newer user command can supersede the in-flight request once.
    scheduler.update(state({ revision: 6, position: 10, startedAt: now }), 24, true, true);
    expect(seek).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 10; i++) { now += 50; scheduler.tick(); }
    expect(seek).toHaveBeenCalledTimes(2);
    audio.seeking = false; cursor = 10;
    scheduler.tick();
    for (let i = 0; i < 10; i++) { now += 100; cursor += 0.1; scheduler.tick(); }
    expect(seek).toHaveBeenCalledTimes(2);
    scheduler.destroy();
  });
  it("ignores transient large drift and bounds automatic seeks, but never delays PAUSE/SEEK", async () => {
    const audio = Object.assign(new Audio(), { seeking: false, readyState: 4 });
    let now = 1750;
    const scheduler = new PlaybackScheduler(audio, () => now);
    scheduler.update(state(), 24, true, true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    now = 4000; audio.currentTime = 0.5; scheduler.tick();
    now += 500; audio.currentTime = 2.75; scheduler.tick();
    expect(scheduler.automaticSeeks).toBe(0);
    now += 500; audio.currentTime = 0.5; scheduler.tick();
    now += 800; scheduler.tick();
    expect(scheduler.automaticSeeks).toBe(1);
    // Simulate a stalled/lagging native cursor after that correction.
    for (let i = 0; i < 40; i++) { now += 100; audio.currentTime = 0.5; scheduler.tick(); }
    expect(scheduler.automaticSeeks).toBe(1);
    scheduler.update(state({ revision: 6, position: 8, startedAt: null, playbackState: "paused" }), 24, true, true);
    expect(audio.paused).toBe(true); expect(audio.currentTime).toBe(8);
    expect(scheduler.commandSeeks).toBe(1);
    scheduler.destroy();
  });
  it("a delayed play promise from a retired track cannot pause the reused element", async () => {
    const audio = new Audio();
    let resolve!: () => void;
    audio.play = () => { audio.paused = false; return new Promise<void>(done => { resolve = done; }); };
    const old = new PlaybackScheduler(audio, () => 1750);
    old.update(state(), 24, true, true);
    const completeOldPlay = resolve;
    old.destroy();
    const next = new PlaybackScheduler(audio, () => 1750);
    next.update(state({ revision: 6, trackRevision: 3, trackId: "nightdrive" }), 24, true, true);
    expect(audio.paused).toBe(false);
    completeOldPlay();
    await Promise.resolve();
    await Promise.resolve();
    expect(audio.paused).toBe(false);
    resolve();
    next.destroy();
  });
  it("rejects play permission without presenting a fake success", async () => {
    const audio = new Audio();
    const fail = vi.fn();
    audio.play = () => Promise.reject(new Error("blocked"));
    const scheduler = new PlaybackScheduler(audio, () => 1750, fail);
    scheduler.update(state(), 24, true, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(fail).toHaveBeenCalledOnce();
    expect(audio.paused).toBe(true);
    scheduler.destroy();
  });
  it("clamps duration, holds a future anchor and restarts at the end", () => {
    const engine = new SyncEngine();
    expect(engine.positionAt(state(), 1500, 24)).toBe(0);
    expect(engine.positionAt(state(), 30_000, 24)).toBe(24);
    expect(
      engine.schedule(
        { position: 24, playbackState: "paused", startedAt: null },
        1000,
        750,
        24,
      ),
    ).toMatchObject({ position: 0, startedAt: 1750 });
  });
  it("leaves the decoder at the head for replay while the server remains ended", () => {
    const audio = new Audio();
    const scheduler = new PlaybackScheduler(audio, () => 2000);
    const ended = state({ playbackState: "paused", startedAt: null, position: 24 });
    scheduler.update(ended, 24, false, true);
    expect(scheduler.metrics).toMatchObject({ phase: "ended", expected: 24, actual: 0, driftMs: null });
    for (let i = 0; i < 10; i++) scheduler.update(ended, 24, true, true);
    expect(audio.currentTime).toBe(0);
    expect(audio.calls).toBe(0);
    scheduler.update(state({ revision: 6, startedAt: 2000 }), 24, true, true);
    expect(audio.calls).toBe(1);
    expect(audio.currentTime).toBe(0);
    scheduler.destroy();
  });
  it("does not restart an ended HTMLAudioElement while awaiting the server end event", () => {
    const audio = Object.assign(new Audio(), { ended: false });
    let now = 1750;
    const scheduler = new PlaybackScheduler(audio, () => now);
    scheduler.update(state(), 24, true, true);
    audio.currentTime = 24;
    audio.paused = true;
    audio.ended = true;
    now += 23_980;
    expect(scheduler.tick().phase).toBe("ended");
    expect(audio.calls).toBe(1);
    expect(audio.paused).toBe(true);
    scheduler.destroy();
  });
  it("rejects delayed old states before merging into a newer room snapshot", () => {
    const room = roomSchema.parse({
      id: "abcdefghij",
      name: "Test",
      hostId: null,
      participants: [],
      trackId: "orbit",
      trackRevision: 2,
      revision: 8,
      position: 5,
      startedAt: null,
      playbackState: "paused",
      createdAt: 1000,
    });
    expect(applyPlaybackState(room, state({ revision: 7 }))).toBe(room);
    expect(
      applyPlaybackState(room, state({ roomId: "otherroom12", revision: 9 })),
    ).toBe(room);
    expect(
      applyPlaybackState(room, state({ revision: 9, position: 12 })),
    ).toMatchObject({ revision: 9, position: 12 });
  });
  it("accepts late membership metadata without rewinding a newer playback timeline", () => {
    const hostId = "H".repeat(16),
      participantId = "L".repeat(16);
    const readiness = {
      status: "ready",
      trackRevision: 2,
      soundUnlocked: true,
      clockSynced: true,
      bufferedSeconds: 24,
    };
    const initial = roomSchema.parse({
      id: "abcdefghij",
      name: "Test",
      hostId,
      participants: [
        { id: hostId, displayName: "Host", joinedAt: 1000, readiness },
      ],
      trackId: "orbit",
      trackRevision: 2,
      revision: 2,
      position: 0,
      startedAt: null,
      playbackState: "paused",
      createdAt: 1000,
    });
    const playback = applyPlaybackState(
      initial,
      state({ revision: 6, position: 12 }),
    )!;
    const membership = roomSchema.parse({
      ...initial,
      revision: 3,
      participants: [
        ...initial.participants,
        {
          id: participantId,
          displayName: "Listener",
          joinedAt: 1100,
          readiness,
        },
      ],
    });
    const result = applyRoomSnapshot(playback, membership, 2);
    expect(result.room).toMatchObject({
      revision: 6,
      position: 12,
      playbackState: "playing",
    });
    expect(result.room.participants).toHaveLength(2);
    expect(
      applyRoomSnapshot(result.room, initial, result.fullRevision).room,
    ).toBe(result.room);
  });
});

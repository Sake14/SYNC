import { describe, expect, it } from "vitest";
import { usesNativeAppleAudio } from "./audio-profile";
import { DriftCorrector } from "./drift-corrector";
import { PlaybackScheduler, type MediaPort } from "./playback-scheduler";
import type { PlaybackState } from "@sync/shared";

describe("native Apple output", () => {
  it("uses normal-speed output across Safari and alternative browsers on iPhone/iPad", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile Safari/604.1",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 YaBrowser/25.0 Mobile Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    ]) expect(usesNativeAppleAudio(ua)).toBe(true);
    expect(usesNativeAppleAudio("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Chrome/140.0 Safari/605.1.15", 5)).toBe(true);
    expect(usesNativeAppleAudio("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe(false);
    expect(usesNativeAppleAudio("Mozilla/5.0 (Android) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe(false);
  });
  it("does not time-stretch moderate errors, but still seeks larger errors and explicit commands", () => {
    const corrector = new DriftCorrector(0.04, 1, 0);
    for (const delta of [-0.8, -0.3, -0.1, 0.1, 0.3, 0.8])
      expect(corrector.correct(10 + delta, 10, 0.99)).toMatchObject({ kind: "none", rate: 1 });
    expect(corrector.correct(8.5, 10)).toMatchObject({ kind: "seek", rate: 1, position: 10 });
    expect(corrector.correct(9.9, 10, 1, true)).toMatchObject({ kind: "seek", rate: 1, position: 10 });
  });
  it("keeps native rate through playback and pause, without disabling scheduled start or seek", async () => {
    let now = 1000;
    const audio: MediaPort = { currentTime: 0, duration: 24, paused: true, playbackRate: 1, preservesPitch: true,
      play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
    const scheduler = new PlaybackScheduler(audio, () => now, undefined, new DriftCorrector(0.04, 1, 0));
    const state: PlaybackState = { roomId: "room", trackId: "orbit", trackRevision: 1, position: 0,
      startedAt: 1750, playbackState: "playing", revision: 1, serverTime: 1000 };
    scheduler.update(state, 24, true, true);
    expect(audio.paused).toBe(true);
    now = 1750; scheduler.tick(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(audio.paused).toBe(false);
    now = 5000; audio.currentTime = 3; scheduler.tick();
    expect(audio.playbackRate).toBe(1); expect(audio.preservesPitch).toBe(true);
    audio.currentTime = 2; scheduler.tick(); expect(audio.currentTime).toBe(2);
    now += 800; scheduler.tick(); expect(audio.currentTime).toBe(4.05);
    scheduler.update({ ...state, revision: 2, position: 8, startedAt: null, playbackState: "paused" }, 24, true, true);
    expect(audio.currentTime).toBe(8); expect(audio.paused).toBe(true);
    scheduler.destroy();
  });
});

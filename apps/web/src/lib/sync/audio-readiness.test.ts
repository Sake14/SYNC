import { describe, expect, it } from "vitest";
import { audioReadiness, bufferAhead, mediaErrorMessage, type BufferedMedia } from "./audio-readiness";

const media = (start = 0, end = 24): BufferedMedia => ({
  readyState: 4, currentTime: 0,
  buffered: { length: 1, start: () => start, end: () => end },
});
const input = () => ({ audio: media(), duration: 24, expected: 0, sourceMatches: true,
  unlocked: true, clockSynced: true, playing: false, failed: false });

describe("audio readiness", () => {
  it("distinguishes an unavailable native audio output from a bad recording", () => {
    expect(mediaErrorMessage(3, "OnMediaSinkAudioError")).toContain("аудиовыходу");
    expect(mediaErrorMessage(3, "Other decoder failure")).toContain("декодировать");
    expect(mediaErrorMessage(2, "OnMediaSinkAudioError")).toContain("Связь");
  });
  it("never declares preload or a muted autoplay a substitute for user permission", () => {
    expect(audioReadiness({ ...input(), unlocked: false })).toMatchObject({ status: "blocked", canContinue: false });
  });
  it("allows the already activated element to prepare another source automatically", () => {
    expect(audioReadiness({ ...input(), sourceMatches: false })).toMatchObject({ status: "buffering", buffered: false });
    expect(audioReadiness(input())).toMatchObject({ status: "ready", buffered: true });
  });
  it("uses the native decoder cursor while playing and tolerates temporary waiting or clock expiry", () => {
    const audio = media(5, 5.3); audio.currentTime = 5;
    expect(audioReadiness({ ...input(), audio, playing: true, expected: 5.6 })).toMatchObject({ status: "ready", canContinue: true });
    expect(audioReadiness({ ...input(), audio, playing: true, clockSynced: false })).toMatchObject({ status: "clock", canContinue: true });
    audio.readyState = 2; audio.currentTime = 5.3;
    expect(audioReadiness({ ...input(), audio, playing: true })).toMatchObject({ status: "buffering", canContinue: true });
    expect(audioReadiness({ ...input(), audio, playing: true, failed: true })).toMatchObject({ status: "error", canContinue: false });
  });
  it("prepares the start for replay after the end and accepts the short remaining tail", () => {
    expect(audioReadiness({ ...input(), expected: 24 })).toMatchObject({ status: "ready", seconds: 24 });
    expect(audioReadiness({ ...input(), expected: 23.8 })).toMatchObject({ status: "ready" });
    expect(bufferAhead(media(5, 10), 1)).toBe(0);
  });
  it("does not mistake a buffered tail for readiness to replay the start", () => {
    const audio = media(23, 24); audio.currentTime = 24;
    expect(audioReadiness({ ...input(), audio, expected: 24 })).toMatchObject({ status: "buffering", seconds: 0 });
    expect(audioReadiness({ ...input(), audio, expected: 24, playing: true })).toMatchObject({ buffered: false });
    audio.buffered = media().buffered; audio.currentTime = 0;
    expect(audioReadiness({ ...input(), audio, expected: 24 })).toMatchObject({ status: "ready" });
  });
});

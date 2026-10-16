import { describe, expect, it } from "vitest";
import { applyAudioOutput, configureMusicSession, musicSessionStatus, type MusicSessionHost } from "./audio-output";

describe("native music output", () => {
  it("selects playback before preparing audio, and keeps that category through pauses", () => {
    const host = { audioSession: { type: "ambient", state: "inactive" } };
    expect(configureMusicSession(host)).toBe(true);
    expect(host.audioSession.type).toBe("playback");
    expect(musicSessionStatus(host)).toBe("playback/inactive");
    host.audioSession.state = "active";
    expect(musicSessionStatus(host)).toBe("playback/active");
  });
  it("does not reconfigure an already selected category or require the experimental API", () => {
    const host = { audioSession: { get type() { return "playback"; }, set type(_value: string) { throw new Error("unnecessary reset"); } } };
    expect(configureMusicSession(host)).toBe(true);
    expect(configureMusicSession({})).toBe(false);
    const inaccessible: MusicSessionHost = { get audioSession(): NonNullable<MusicSessionHost["audioSession"]> { throw new Error("Unsupported"); } };
    expect(configureMusicSession(inaccessible)).toBe(false);
    expect(musicSessionStatus(inaccessible)).toBe("API недоступен");
  });
  it("restores sound after a cancelled silent preparation, while retaining the user's mute preference", () => {
    const audio = { volume: 1, muted: false }, preferences = { volume: 0.7, muted: false };
    applyAudioOutput(audio, preferences, true);
    expect(audio.muted).toBe(true);
    applyAudioOutput(audio, preferences);
    expect(audio).toEqual({ volume: 0.7, muted: false });
    applyAudioOutput(audio, { volume: 0.4, muted: true });
    expect(audio).toEqual({ volume: 0.4, muted: true });
    applyAudioOutput(audio, { volume: 0, muted: false });
    expect(audio.muted).toBe(true);
  });
  it("a device refusing software volume still allows unmute before native play", () => {
    const audio = { get volume() { return 1; }, set volume(_next: number) { throw new Error("OS volume"); }, muted: true };
    expect(applyAudioOutput(audio, { volume: 0.7, muted: false })).toBe(false);
    expect(audio.muted).toBe(false);
  });
});

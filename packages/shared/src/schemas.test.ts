import { describe, expect, it } from "vitest";
import { clockPingSchema, displayNameSchema, playbackStateSchema, roomIdSchema, trackSchema } from "./index.js";

describe("shared input boundaries", () => {
  it("trims names and rejects blank or oversized names", () => {
    expect(displayNameSchema.parse("  Кирилл  ")).toBe("Кирилл");
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
    expect(displayNameSchema.safeParse("я".repeat(33)).success).toBe(false);
  });
  it("limits room codes to URL-safe identifiers", () => {
    expect(roomIdSchema.safeParse("Abcdef_123-x").success).toBe(true);
    expect(roomIdSchema.safeParse("../../admin").success).toBe(false);
  });
  it.each([null, {}, { clientSentAtMs: -1 }, { clientSentAtMs: Infinity }, { clientSentAtMs: "123" }])("rejects malformed clock samples: %j", (sample) => {
    expect(clockPingSchema.safeParse(sample).success).toBe(false);
  });
  it("requires a track before playing", () => {
    const state = { roomId: "abcdefghij", trackId: "track", trackRevision: 1, playbackState: "playing", position: 0, startedAt: 1000, revision: 1, serverTime: 1000 };
    expect(playbackStateSchema.safeParse(state).success).toBe(true);
    expect(playbackStateSchema.safeParse({ ...state, trackId: null }).success).toBe(false);
    expect(playbackStateSchema.safeParse({ ...state, startedAt: null }).success).toBe(false);
    expect(playbackStateSchema.safeParse({ ...state, playbackState: "paused" }).success).toBe(false);
  });
  it("prevents external and traversal paths in the media contract", () => {
    const track = { id: "test", title: "Test", artist: "Test", durationSeconds: 30 };
    expect(trackSchema.safeParse({ ...track, streamPath: "/media/test.mp3" }).success).toBe(true);
    for (const streamPath of ["https://example.com/a.mp3", "/media/../private.mp3", "data:audio/wav;base64,test"]) {
      expect(trackSchema.safeParse({ ...track, streamPath }).success).toBe(false);
    }
  });
});

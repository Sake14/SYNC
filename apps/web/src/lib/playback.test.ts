import { describe, expect, it } from "vitest";
import { clockSample, positionAt, formatTime } from "./playback";

describe("browser playback timeline", () => {
  it("projects server anchors, clamps duration and preserves paused position", () => {
    expect(
      positionAt(
        { position: 4, playbackState: "playing", startedAt: 1000 },
        4000,
        24,
      ),
    ).toBe(7);
    expect(
      positionAt(
        { position: 4, playbackState: "playing", startedAt: 1000 },
        500,
        24,
      ),
    ).toBe(4);
    expect(
      positionAt(
        { position: 23, playbackState: "playing", startedAt: 1000 },
        4000,
        24,
      ),
    ).toBe(24);
    expect(
      positionAt(
        { position: 4, playbackState: "paused", startedAt: null },
        4000,
        24,
      ),
    ).toBe(4);
  });
  it("estimates clock offset without counting server processing as network delay", () => {
    expect(clockSample(1000, 6020, 6030, 1050)).toEqual({
      rtt: 40,
      offset: 5000,
    });
    expect(clockSample(1000, 6020, 6030, 4000)).toBeNull();
    expect(clockSample(1000, 6020, 6010, 1050)).toBeNull();
  });
  it("formats duration and progress without rounded overflow", () => {
    expect(formatTime(65.9)).toBe("1:05");
    expect(formatTime(-1)).toBe("0:00");
  });
});

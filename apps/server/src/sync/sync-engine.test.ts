import { describe, expect, it } from "vitest";
import type { Room } from "@sync/shared";
import { SyncEngine } from "./sync-engine.js";

describe("server timeline projection", () => {
  const engine = new SyncEngine();
  const state: Pick<Room, "playbackState" | "position" | "startedAt"> = { playbackState: "playing", position: 10, startedAt: 1000 };
  it("projects elapsed time in seconds", () => { expect(engine.positionAt(state, 3500)).toBe(12.5); });
  it("holds a paused timeline", () => { expect(engine.positionAt({ ...state, playbackState: "paused", startedAt: null }, 3500)).toBe(10); });
  it("does not rewind when the supplied clock precedes the snapshot", () => { expect(engine.positionAt(state, 0)).toBe(10); });
  it("does not add elapsed time without an anchor", () => { expect(engine.positionAt({ ...state, startedAt: null }, 100_000)).toBe(10); });
});

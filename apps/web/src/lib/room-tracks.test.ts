import { describe, expect, it } from "vitest";
import type { Track } from "@sync/shared";
import { mergeRoomTracks } from "./room-tracks";

const track: Track = { id: "upload_test", title: "Запись", artist: "А", durationSeconds: 24, streamPath: "/media/test.wav" };
describe("room library updates and the audio lifecycle", () => {
  it("preserves an unchanged uploaded track across readiness/queue snapshots", () => {
    expect(mergeRoomTracks([], [{ ...track }], [track])[0]).toBe(track);
  });
  it("updates changed files and removes tracks of the departed room", () => {
    const changed = { ...track, streamPath: "/media/new.wav" };
    expect(mergeRoomTracks([], [changed], [track])[0]).toBe(changed);
    expect(mergeRoomTracks([], [], [track])).toEqual([]);
  });
});

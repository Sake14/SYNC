import { describe, expect, it } from "vitest";
import type { Track } from "@sync/shared";
import { RoomManager } from "./room-manager.js";

function fixture() {
  let time = 1000;
  const rooms = new RoomManager({ now: () => time, getTrackDuration: id => ["one", "two"].includes(id) ? 24 : undefined });
  const host = rooms.create("host", { displayName: "А" }).membership;
  const id = host.snapshot.room.id;
  const peer = rooms.join("peer", { roomId: id, displayName: "Б" }).membership;
  const command = () => ({ roomId: id, expectedRevision: rooms.getSnapshot("host", { roomId: id }).room.revision });
  return { rooms, host, peer, id, command, advance: (ms: number) => { time += ms; } };
}
const privateTrack: Track = { id: `upload_${"a".repeat(32)}`, title: "Своя запись", artist: "Б", durationSeconds: 12, cover: "pulse", streamPath: `/media/room_${"a".repeat(12)}_upload_${"a".repeat(32)}.wav` };

describe("shared queue and room library", () => {
  it("allows participants to contribute, protects authorship and HOST ordering, rejects stale edits", () => {
    const { rooms, id, host, peer, command } = fixture();
    const old = command();
    const first = rooms.addToQueue("peer", { ...command(), trackId: "one" }).room.queue[0]!;
    expect(first).toMatchObject({ trackId: "one", addedBy: peer.participantId, addedByName: "Б" });
    expect(() => rooms.addToQueue("host", { ...old, trackId: "two" })).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
    const second = rooms.addToQueue("host", { ...command(), trackId: "two" }).room.queue[1]!;
    expect(second.addedBy).toBe(host.participantId);
    expect(second.id).not.toBe(first.id);
    expect(() => rooms.removeFromQueue("peer", { ...command(), entryId: second.id })).toThrowError(expect.objectContaining({ code: "NOT_QUEUE_OWNER" }));
    expect(() => rooms.moveQueueEntry("peer", { ...command(), entryId: second.id, direction: "up" })).toThrowError(expect.objectContaining({ code: "NOT_HOST" }));
    expect(rooms.moveQueueEntry("host", { ...command(), entryId: second.id, direction: "up" }).room.queue.map(e => e.trackId)).toEqual(["two", "one"]);
    rooms.removeFromQueue("peer", { ...command(), entryId: first.id });
    expect(rooms.nextInQueue("host", command()).room).toMatchObject({ trackId: "two", position: 0, playbackState: "paused", queue: [] });
    expect(() => rooms.nextInQueue("host", command())).toThrowError(expect.objectContaining({ code: "QUEUE_EMPTY" }));
    expect(() => rooms.addToQueue("outside", { ...command(), trackId: "one" })).toThrowError(expect.objectContaining({ code: "NOT_MEMBER" }));
    expect(rooms.getSnapshot("host", { roomId: id }).room.participants.every(p => p.readiness.status !== "ready")).toBe(true);
  });
  it("bounds the queue and validates track availability", () => {
    const { rooms, command } = fixture();
    expect(() => rooms.addToQueue("peer", { ...command(), trackId: "missing" })).toThrowError(expect.objectContaining({ code: "TRACK_NOT_FOUND" }));
    for (let i = 0; i < 50; i++) rooms.addToQueue("peer", { ...command(), trackId: "one" });
    expect(() => rooms.addToQueue("host", { ...command(), trackId: "two" })).toThrowError(expect.objectContaining({ code: "QUEUE_FULL" }));
  });
  it("shares private tracks only inside the room and restores library/queue on reconnect", () => {
    const { rooms, id, peer, command } = fixture();
    rooms.addLibraryTrack("peer", id, privateTrack);
    rooms.addToQueue("peer", { ...command(), trackId: privateTrack.id });
    rooms.changeTrack("host", { ...command(), trackId: privateTrack.id });
    expect(rooms.seek("host", { ...command(), position: 99 }).position).toBe(12);
    rooms.disconnect("peer");
    expect(() => rooms.authorizeToken(id, peer.resumeToken)).toThrowError(expect.objectContaining({ code: "INVALID_SESSION" }));
    const returned = rooms.join("returned", { roomId: id, resumeToken: peer.resumeToken }).membership;
    expect(returned.snapshot.room.library).toEqual([privateTrack]);
    expect(returned.snapshot.room.queue[0]?.trackId).toBe(privateTrack.id);
    expect(rooms.authorizeToken(id, peer.resumeToken)).toBe("returned");
    const other = rooms.create("other", { displayName: "Other" }).membership.snapshot.room;
    expect(() => rooms.changeTrack("other", { roomId: other.id, expectedRevision: other.revision, trackId: privateTrack.id })).toThrowError(expect.objectContaining({ code: "TRACK_NOT_FOUND" }));
    expect(() => rooms.addLibraryTrack("other", id, privateTrack)).toThrowError(expect.objectContaining({ code: "NOT_MEMBER" }));
  });
  it("selects the next queued track at the end and waits for fresh audio readiness", () => {
    const { rooms, id, command, advance } = fixture();
    rooms.changeTrack("host", { ...command(), trackId: "one" });
    rooms.addToQueue("peer", { ...command(), trackId: "two" });
    for (const client of ["host", "peer"]) {
      const room = rooms.getSnapshot(client, { roomId: id }).room;
      rooms.reportReady(client, { roomId: id, trackId: "one", trackRevision: room.trackRevision, sequence: 1, status: "ready", bufferedSeconds: 24, soundUnlocked: true, clockSynced: true });
    }
    rooms.play("host", command());
    advance(25_000);
    expect(rooms.finishTracks()[0]).toMatchObject({ trackId: "two", playbackState: "paused", position: 0 });
    expect(rooms.getSnapshot("host", { roomId: id }).room.queue).toEqual([]);
    expect(() => rooms.play("host", command())).toThrowError(expect.objectContaining({ code: "NOT_READY" }));
  });
  it("generates authoritative reactions without changing playback revision and rate limits each participant", () => {
    const { rooms, id, peer, command, advance } = fixture();
    const before = command();
    expect(rooms.react("peer", { roomId: id, emoji: "🔥" })).toMatchObject({ participantId: peer.participantId, displayName: "Б", emoji: "🔥", serverTime: 1000 });
    expect(command()).toEqual(before);
    expect(() => rooms.react("peer", { roomId: id, emoji: "❤️" })).toThrowError(expect.objectContaining({ code: "RATE_LIMIT" }));
    expect(() => rooms.react("outside", { roomId: id, emoji: "🎧" })).toThrowError(expect.objectContaining({ code: "NOT_MEMBER" }));
    advance(500);
    expect(rooms.react("peer", { roomId: id, emoji: "😭" }).emoji).toBe("😭");
  });
});

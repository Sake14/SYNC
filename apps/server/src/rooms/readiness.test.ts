import { describe, expect, it } from "vitest";
import type { PlayerReadyInput } from "@sync/shared";
import { RoomManager } from "./room-manager.js";

function fixture() {
  let now = 1000;
  const rooms = new RoomManager({ now: () => now, getTrackDuration: () => 24 });
  const host = rooms.create("host", { displayName: "Host" }).membership;
  const id = host.snapshot.room.id;
  rooms.join("listener", { roomId: id, displayName: "Listener" });
  const command = (client = "host") => ({
    roomId: id,
    expectedRevision: rooms.getSnapshot(client, { roomId: id }).room.revision,
  });
  rooms.changeTrack("host", { ...command(), trackId: "orbit" });
  const input = (
    client = "host",
    overrides: Partial<PlayerReadyInput> = {},
  ): PlayerReadyInput => {
    const room = rooms.getSnapshot(client, { roomId: id }).room;
    return {
      roomId: id,
      trackId: room.trackId!,
      trackRevision: room.trackRevision,
      sequence: room.revision,
      status: "ready",
      bufferedSeconds: 24,
      soundUnlocked: true,
      clockSynced: true,
      ...overrides,
    };
  };
  return {
    rooms,
    id,
    host,
    command,
    input,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("buffer readiness and scheduled starts", () => {
  it("requires every active device to confirm buffer, sound and clock calibration", () => {
    const { rooms, command, input } = fixture();
    expect(() => rooms.play("host", command())).toThrowError(
      expect.objectContaining({ code: "NOT_READY" }),
    );
    rooms.reportReady("host", input());
    rooms.reportReady(
      "listener",
      input("listener", { status: "blocked", soundUnlocked: false }),
    );
    expect(() => rooms.play("host", command())).toThrowError(
      expect.objectContaining({ code: "NOT_READY" }),
    );
    rooms.reportReady("listener", input("listener"));
    expect(rooms.play("host", command())).toMatchObject({
      startedAt: 1750,
      position: 0,
      playbackState: "playing",
    });
  });
  it("does not accept false readiness, outsiders or reports for a previous track", () => {
    const { rooms, id, command, input } = fixture();
    const old = input();
    expect(() => rooms.reportReady("outsider", old)).toThrowError(
      expect.objectContaining({ code: "NOT_MEMBER" }),
    );
    expect(() =>
      rooms.reportReady("host", input("host", { soundUnlocked: false })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
    rooms.changeTrack("host", { ...command(), trackId: "orbit" });
    expect(() => rooms.reportReady("host", old)).toThrowError(
      expect.objectContaining({ code: "STALE_REVISION" }),
    );
    expect(
      rooms
        .getSnapshot("host", { roomId: id })
        .room.participants.every((p) => p.readiness.status !== "ready"),
    ).toBe(true);
  });
  it("rejects out-of-order report sequences; heartbeat does not inflate revision", () => {
    const { rooms, id, input } = fixture();
    const ready = input();
    rooms.reportReady("host", ready);
    const before = rooms.getSnapshot("host", { roomId: id });
    const fresh = { ...ready, sequence: ready.sequence + 1 };
    rooms.reportReady("host", fresh);
    expect(rooms.getSnapshot("host", { roomId: id })).toEqual(before);
    expect(() =>
      rooms.reportReady("host", {
        ...ready,
        status: "blocked",
        soundUnlocked: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
  });
  it("expires old readiness and pauses before the scheduled start without advancing position", () => {
    const { rooms, id, command, input, advance } = fixture();
    rooms.reportReady("host", input());
    rooms.reportReady("listener", input("listener"));
    rooms.play("host", command());
    advance(200);
    expect(rooms.pause("host", command())).toMatchObject({
      position: 0,
      startedAt: null,
    });
    advance(14_800);
    expect(() => rooms.play("host", command())).toThrowError(
      expect.objectContaining({ code: "NOT_READY" }),
    );
    expect(rooms.expireReadiness()).toHaveLength(1);
    expect(
      rooms
        .getSnapshot("host", { roomId: id })
        .room.participants.map((p) => p.readiness.status),
    ).toEqual(["stale", "stale"]);
  });
  it("late join does not alter an existing timeline, reconnect clears capability claims", () => {
    const { rooms, id, host, command, input, advance } = fixture();
    rooms.reportReady("host", input());
    rooms.reportReady("listener", input("listener"));
    const play = rooms.play("host", command());
    advance(1500);
    const joined = rooms.join("late", { roomId: id, displayName: "Late" });
    expect(joined.membership.snapshot.room.startedAt).toBe(play.startedAt);
    expect(
      joined.membership.snapshot.room.participants.at(-1)?.readiness.status,
    ).toBe("loading");
    rooms.disconnect("host");
    const restored = rooms.join("returned", {
      roomId: id,
      resumeToken: host.resumeToken,
    }).membership;
    expect(restored.snapshot.room.startedAt).toBe(play.startedAt);
    expect(
      restored.snapshot.room.participants.find(
        (p) => p.id === host.participantId,
      )?.readiness.status,
    ).toBe("loading");
  });
});

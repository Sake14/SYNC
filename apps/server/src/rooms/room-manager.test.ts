import { describe, expect, it } from "vitest";
import { membershipSchema, roomSnapshotSchema, type ErrorCode } from "@sync/shared";
import { RoomManager, type RoomManagerOptions } from "./room-manager.js";

function setup(options: RoomManagerOptions = {}) {
  let time = 10_000;
  const rooms = new RoomManager({ now: () => time, ...options });
  const host = rooms.create("host", { displayName: "Host" }).membership;
  const roomId = host.snapshot.room.id;
  return {
    rooms, host, roomId,
    advance: (ms: number) => { time += ms; },
    snapshot: (connectionId = "host") => rooms.getSnapshot(connectionId, { roomId }),
    command: (connectionId = "host") => ({ roomId, expectedRevision: rooms.getSnapshot(connectionId, { roomId }).room.revision }),
    join: (connectionId: string) => rooms.join(connectionId, { roomId, displayName: connectionId }).membership,
  };
}
function playReady(rooms: RoomManager, connectionId: string, input: {roomId: string; expectedRevision: number}) {
  const room = rooms.getSnapshot(connectionId, input).room;
  rooms.reportReady(connectionId, {roomId: room.id, trackId: room.trackId!, trackRevision: room.trackRevision, sequence: room.revision,
    status: "ready", bufferedSeconds: 24, soundUnlocked: true, clockSynced: true});
  return rooms.play(connectionId, {roomId: room.id, expectedRevision: rooms.getSnapshot(connectionId, input).room.revision});
}
const rejects = (action: () => unknown, code: ErrorCode) => expect(action).toThrowError(expect.objectContaining({ code }));

describe("RoomManager membership", () => {
  it("stores the supplied room name in snapshots", () => {
    const rooms = new RoomManager();
    expect(rooms.create("host", { displayName: "Host", name: "Вечер вместе" }).membership.snapshot.room.name).toBe("Вечер вместе");
  });
  it("creates unique rooms, assigns the creator as HOST and keeps credentials private", () => {
    const { rooms, host, snapshot } = setup();
    const second = rooms.create("other", { displayName: "Other" }).membership;
    expect(membershipSchema.safeParse(host).success).toBe(true);
    expect(host.snapshot.room.hostId).toBe(host.participantId);
    expect(host.snapshot.room).toMatchObject({ trackId: null, playbackState: "paused", position: 0, startedAt: null, revision: 1 });
    expect(second.snapshot.room.id).not.toBe(host.snapshot.room.id);
    expect(JSON.stringify(snapshot())).not.toContain(host.resumeToken);
    expect(rooms.size).toBe(2);
  });

  it("retries a colliding room ID without overwriting the first room", () => {
    let roomIds = 0;
    const { rooms, host } = setup({ generateId: (size) => size === 12 ? (roomIds++ < 2 ? "A" : "B").repeat(size) : "C".repeat(size) });
    const second = rooms.create("other", { displayName: "Other" }).membership;
    expect(second.snapshot.room.id).toBe("B".repeat(12));
    expect(rooms.getSnapshot("host", { roomId: host.snapshot.room.id }).room.hostId).toBe(host.participantId);
  });

  it("bounds collision retries and leaves existing state intact", () => {
    const { rooms, snapshot } = setup({ generateId: (size) => "A".repeat(size) });
    rejects(() => rooms.create("other", { displayName: "Other" }), "ID_EXHAUSTED");
    expect(rooms.size).toBe(1);
    expect(snapshot().room.revision).toBe(1);
  });

  it("lists participants, makes joining idempotent and protects snapshots from mutation", () => {
    const { rooms, roomId, join, snapshot } = setup();
    const listener = join("listener");
    const duplicate = join("listener");
    expect(duplicate).toEqual(listener);
    expect(rooms.getParticipants("listener", { roomId })).toHaveLength(2);
    listener.snapshot.room.participants.length = 0;
    listener.snapshot.room.position = 900;
    const names = rooms.getParticipants("host", { roomId });
    names[0]!.displayName = "tampered";
    expect(snapshot().room.participants[0]!.displayName).toBe("Host");
    expect(snapshot().room.position).toBe(0);
    expect(roomSnapshotSchema.safeParse(snapshot()).success).toBe(true);
  });

  it("does not switch or abandon a room when another join/create is attempted", () => {
    const { rooms, snapshot } = setup();
    const other = rooms.create("other", { displayName: "Other" }).membership.snapshot.room.id;
    rejects(() => rooms.join("host", { roomId: other, displayName: "Host" }), "ALREADY_IN_ROOM");
    rejects(() => rooms.create("host", { displayName: "Host" }), "ALREADY_IN_ROOM");
    expect(snapshot().room.participants).toHaveLength(1);
  });

  it("returns ROOM_NOT_FOUND for missing rooms", () => {
    const { rooms } = setup();
    const roomId = "missingroom12";
    rejects(() => rooms.join("other", { roomId, displayName: "Other" }), "ROOM_NOT_FOUND");
    rejects(() => rooms.getSnapshot("host", { roomId }), "ROOM_NOT_FOUND");
  });

  it("enforces participant limits without corrupting membership", () => {
    const { rooms, roomId, join, snapshot } = setup({ maxParticipants: 2 });
    join("listener");
    rejects(() => join("overflow"), "ROOM_FULL");
    rejects(() => rooms.getParticipants("overflow", { roomId }), "NOT_MEMBER");
    expect(snapshot().room.participants).toHaveLength(2);
    rooms.disconnect("listener");
    expect(join("overflow").snapshot.room.participants).toHaveLength(2);
  });

  it("removes disconnected listeners immediately and promotes the next active HOST", () => {
    const { rooms, host, join, snapshot } = setup();
    const first = join("first");
    const second = join("second");
    const left = rooms.disconnect("host")!;
    expect(left.event).toMatchObject({ participantId: host.participantId, hostId: first.participantId, reason: "disconnect" });
    expect(snapshot("first").room.participants.map((participant) => participant.id)).toEqual([first.participantId, second.participantId]);
    expect(rooms.disconnect("host")).toBeNull();
    expect(rooms.disconnect("first")!.snapshot.room.hostId).toBe(second.participantId);
  });

  it("rejects nonmembers even if they know the room, revision and HOST ID", () => {
    const { rooms, roomId, command } = setup();
    for (const action of [
      () => rooms.getSnapshot("outsider", { roomId }),
      () => rooms.getParticipants("outsider", { roomId }),
      () => rooms.leave("outsider", command()),
      () => rooms.play("outsider", command()),
      () => rooms.pause("outsider", command()),
      () => rooms.seek("outsider", { ...command(), position: 10 }),
      () => rooms.changeTrack("outsider", { ...command(), trackId: "track" }),
    ]) rejects(action, "NOT_MEMBER");
  });
});

describe("RoomManager reconnect and lifecycle", () => {
  it("transfers HOST without changing playback, then revokes a kicked participant's session", () => {
    const { rooms, join, host, command, snapshot, roomId } = setup();
    rooms.changeTrack("host", { ...command(), trackId: "first" });
    playReady(rooms, "host", command());
    const listener = join("listener");
    const target = { ...command(), participantId: listener.participantId };
    rejects(() => rooms.transferHost("listener", target), "NOT_HOST");
    rejects(() => rooms.kick("outsider", target), "NOT_MEMBER");
    rejects(() => rooms.kick("host", { ...command(), participantId: host.participantId }), "CANNOT_REMOVE_HOST");
    rejects(() => rooms.transferHost("host", { ...command(), participantId: "X".repeat(16) }), "PARTICIPANT_NOT_FOUND");
    const before = snapshot().room;
    const transferred = rooms.transferHost("host", target).room;
    expect(transferred).toMatchObject({ hostId: listener.participantId, startedAt: before.startedAt, playbackState: "playing" });
    rejects(() => rooms.kick("host", { ...command(), participantId: listener.participantId }), "NOT_HOST");
    rejects(() => rooms.kick("listener", { ...target, participantId: host.participantId }), "STALE_REVISION");
    const removed = rooms.kick("listener", { ...command("listener"), participantId: host.participantId });
    expect(removed).toMatchObject({ connectionId: "host", event: { reason: "kick", hostId: listener.participantId } });
    expect(removed.snapshot.room.participants).toHaveLength(1);
    expect(rooms.disconnect("host")).toBeNull();
    rejects(() => rooms.getSnapshot("host", { roomId }), "NOT_MEMBER");
    rejects(() => rooms.authorizeToken(roomId, host.resumeToken), "INVALID_SESSION");
    rejects(() => rooms.join("return", { roomId, resumeToken: host.resumeToken }), "INVALID_SESSION");
    expect(join("fresh").resumed).toBe(false);
  });

  it("rejects transfer and kick targets from another room or an offline session", () => {
    const { rooms, join, command } = setup();
    const offline = join("offline");
    rooms.disconnect("offline");
    const other = rooms.create("other", { displayName: "Other" }).membership;
    for (const participantId of [offline.participantId, other.participantId]) {
      rejects(() => rooms.kick("host", { ...command(), participantId }), "PARTICIPANT_NOT_FOUND");
      rejects(() => rooms.transferHost("host", { ...command(), participantId }), "PARTICIPANT_NOT_FOUND");
    }
  });
  it("restores identity and current state, without taking HOST back from the new host", () => {
    const { rooms, host, roomId, join, command, advance } = setup();
    const listener = join("listener");
    rooms.disconnect("host");
    rooms.changeTrack("listener", { ...command("listener"), trackId: "new-track" });
    rooms.seek("listener", { ...command("listener"), position: 45 });
    playReady(rooms, "listener", command("listener"));
    advance(2000);
    const restored = rooms.join("reconnected", { roomId, resumeToken: host.resumeToken }).membership;
    expect(restored.participantId).toBe(host.participantId);
    expect(restored.resumed).toBe(true);
    expect(restored.snapshot.room).toMatchObject({ hostId: listener.participantId, trackId: "new-track", playbackState: "playing", position: 45, startedAt: 10_750 });
    expect(restored.snapshot.serverTime).toBe(12_000);
    rejects(() => rooms.seek("reconnected", { roomId, expectedRevision: restored.snapshot.room.revision, position: 0 }), "NOT_HOST");
  });

  it("atomically replaces an active connection and ignores its delayed disconnect/commands", () => {
    const { rooms, host, roomId, command, snapshot } = setup();
    const oldCommand = command();
    const result = rooms.join("new", { roomId, resumeToken: host.resumeToken });
    expect(result.replacedConnectionId).toBe("host");
    expect(result.participantJoined).toBe(false);
    expect(result.membership.snapshot.room.participants).toHaveLength(1);
    expect(result.membership.snapshot.room.hostId).toBe(host.participantId);
    expect(rooms.disconnect("host")).toBeNull();
    rejects(() => rooms.changeTrack("host", { ...oldCommand, trackId: "bad" }), "NOT_MEMBER");
    rejects(() => rooms.changeTrack("new", { ...oldCommand, trackId: "stale" }), "STALE_REVISION");
    expect(snapshot("new").room.trackId).toBeNull();
  });

  it("rejects fabricated credentials and tokens from another room", () => {
    const { rooms, roomId, snapshot } = setup();
    const other = rooms.create("other", { displayName: "Other" }).membership;
    rejects(() => rooms.join("intruder", { roomId, resumeToken: "X".repeat(32) }), "INVALID_SESSION");
    rejects(() => rooms.join("intruder", { roomId, resumeToken: other.resumeToken }), "INVALID_SESSION");
    expect(snapshot().room.participants).toHaveLength(1);
  });

  it("expires disconnected sessions at the exact grace boundary", () => {
    const { rooms, host, roomId, advance } = setup({ reconnectGraceMs: 100 });
    rooms.disconnect("host");
    advance(100);
    rejects(() => rooms.join("new", { roomId, resumeToken: host.resumeToken }), "INVALID_SESSION");
  });

  it("requires a free participant slot to resume an offline session", () => {
    const { rooms, host, roomId, join } = setup({ maxParticipants: 1 });
    rooms.disconnect("host");
    join("replacement");
    rejects(() => rooms.join("new", { roomId, resumeToken: host.resumeToken }), "ROOM_FULL");
  });

  it("revokes a token on explicit leave and prevents stale leave after rejoin", () => {
    const { rooms, host, roomId, command, join, snapshot } = setup();
    const oldCommand = command();
    rooms.leave("host", oldCommand);
    rejects(() => rooms.join("return", { roomId, resumeToken: host.resumeToken }), "INVALID_SESSION");
    join("host");
    rejects(() => rooms.leave("host", oldCommand), "STALE_REVISION");
    expect(snapshot().room.participants).toHaveLength(1);
  });

  it("pauses an empty room at the authoritative position and retains it for reconnect", () => {
    const { rooms, host, roomId, command, advance } = setup();
    rooms.changeTrack("host", { ...command(), trackId: "track" });
    playReady(rooms, "host", command());
    advance(2500);
    const left = rooms.disconnect("host")!;
    expect(left.snapshot.room).toMatchObject({ hostId: null, participants: [], playbackState: "paused", position: 1.75, startedAt: null });
    advance(1000);
    const resumed = rooms.join("new", { roomId, resumeToken: host.resumeToken }).membership;
    expect(resumed.snapshot.room).toMatchObject({ hostId: host.participantId, position: 1.75, playbackState: "paused" });
  });

  it("cleans empty rooms and their sessions without expiring active rooms", () => {
    const { rooms, host, roomId, command, advance } = setup({ reconnectGraceMs: 10, emptyRoomTtlMs: 100, maxRooms: 2 });
    rooms.create("active", { displayName: "Active" });
    rooms.leave("host", command());
    advance(100);
    rooms.sweep();
    expect(rooms.size).toBe(1);
    rejects(() => rooms.join("new", { roomId, resumeToken: host.resumeToken }), "ROOM_NOT_FOUND");
  });

  it("enforces global room limits and reclaims expired rooms on create", () => {
    const { rooms, advance } = setup({ maxRooms: 1, reconnectGraceMs: 10, emptyRoomTtlMs: 100 });
    rejects(() => rooms.create("other", { displayName: "Other" }), "ROOM_LIMIT");
    rooms.disconnect("host");
    advance(100);
    expect(rooms.create("other", { displayName: "Other" }).membership.snapshot.room.participants).toHaveLength(1);
    expect(rooms.size).toBe(1);
  });

  it("bounds retained offline sessions without reserving unlimited memory", () => {
    const { rooms, join, advance } = setup({ maxParticipants: 1, reconnectGraceMs: 100 });
    rooms.disconnect("host");
    for (let i = 0; i < 3; i++) { join(`guest${i}`); rooms.disconnect(`guest${i}`); }
    rejects(() => join("overflow"), "SESSION_LIMIT");
    advance(100);
    expect(join("overflow").snapshot.room.participants).toHaveLength(1);
  });
});

describe("RoomManager playback authority", () => {
  it("only permits HOST play, seek and track commands", () => {
    const { rooms, join, command } = setup();
    join("listener");
    for (const action of [
      () => rooms.play("listener", command()),
      () => rooms.seek("listener", { ...command(), position: 10 }),
      () => rooms.changeTrack("listener", { ...command(), trackId: "track" }),
    ]) rejects(action, "NOT_HOST");
  });

  it("lets any current member pause while rejecting stale commands and outsiders", () => {
    const { rooms, command, join, advance, roomId } = setup();
    rooms.changeTrack("host", { ...command(), trackId: "first" });
    playReady(rooms, "host", command());
    join("listener");
    const stale = command("listener");
    rooms.seek("host", { ...command(), position: 5 });
    rejects(() => rooms.pause("listener", stale), "STALE_REVISION");
    rejects(() => rooms.pause("outsider", { roomId, expectedRevision: command().expectedRevision }), "NOT_MEMBER");
    advance(1000);
    expect(rooms.pause("listener", command("listener"))).toMatchObject({ playbackState: "paused", position: 6, startedAt: null });
  });

  it("rejects play, pause and seek without a selected track", () => {
    const { rooms, command, snapshot } = setup();
    rejects(() => rooms.play("host", command()), "NO_TRACK");
    rejects(() => rooms.pause("host", command()), "NO_TRACK");
    rejects(() => rooms.seek("host", { ...command(), position: 12 }), "NO_TRACK");
    expect(snapshot().room.revision).toBe(1);
  });

  it("computes play/pause/seek from the server timeline and resets on track changes", () => {
    const { rooms, command, advance } = setup();
    rooms.changeTrack("host", { ...command(), trackId: "first" });
    expect(playReady(rooms, "host", command())).toMatchObject({ playbackState: "playing", startedAt: 10_750, position: 0 });
    advance(1500);
    expect(rooms.pause("host", command())).toMatchObject({ playbackState: "paused", startedAt: null, position: .75 });
    advance(3000);
    expect(rooms.seek("host", { ...command(), position: 30 })).toMatchObject({ startedAt: null, position: 30 });
    playReady(rooms, "host", command());
    advance(2000);
    expect(rooms.seek("host", { ...command(), position: 12 })).toMatchObject({ startedAt: 16_500, position: 12 });
    advance(500);
    expect(rooms.pause("host", command()).position).toBe(12.5);
    expect(rooms.changeTrack("host", { ...command(), trackId: "second" })).toMatchObject({ trackId: "second", playbackState: "paused", position: 0, startedAt: null });
    expect(rooms.changeTrack("host", { ...command(), trackId: null }).trackId).toBeNull();
  });

  it("rejects replayed, out-of-order and future revisions without state changes", () => {
    const { rooms, command, snapshot } = setup();
    const old = command();
    rooms.changeTrack("host", { ...old, trackId: "current" });
    const before = snapshot();
    rejects(() => rooms.changeTrack("host", { ...old, trackId: "old" }), "STALE_REVISION");
    rejects(() => rooms.play("host", { ...old, expectedRevision: 999 }), "STALE_REVISION");
    expect(snapshot()).toEqual(before);
  });

  it("does not rewind after a backwards wall-clock adjustment", () => {
    const { rooms, command, advance } = setup();
    rooms.changeTrack("host", { ...command(), trackId: "track" });
    playReady(rooms, "host", command());
    advance(2000);
    expect(rooms.pause("host", command()).position).toBe(1.25);
    advance(-5000);
    expect(playReady(rooms, "host", command())).toMatchObject({ position: 1.25, startedAt: 12_750, serverTime: 12_000 });
  });
});

describe("catalog-aware playback", () => {
  it("rejects unknown tracks after membership and HOST checks", () => {
    const { rooms, command, snapshot, join, roomId } = setup({ getTrackDuration: (id) => id === "orbit" ? 24 : undefined });
    join("listener");
    rejects(() => rooms.changeTrack("outsider", { ...command(), trackId: "unknown" }), "NOT_MEMBER");
    rejects(() => rooms.changeTrack("listener", { ...command("listener"), trackId: "unknown" }), "NOT_HOST");
    rejects(() => rooms.changeTrack("host", { ...command(), trackId: "unknown" }), "TRACK_NOT_FOUND");
    expect(snapshot().room.trackId).toBeNull();
    expect(rooms.changeTrack("host", { ...command(), trackId: "orbit" }).roomId).toBe(roomId);
  });
  it("clamps seek, finishes without a browser command and restarts from the beginning", () => {
    const { rooms, command, advance, snapshot } = setup({ getTrackDuration: () => 24 });
    rooms.changeTrack("host", { ...command(), trackId: "orbit" });
    expect(rooms.seek("host", { ...command(), position: 999 }).position).toBe(24);
    expect(playReady(rooms, "host", command()).position).toBe(0);
    advance(24_750);
    const previous = snapshot().room.revision;
    expect(rooms.finishTracks()).toEqual([expect.objectContaining({ position: 24, playbackState: "paused", startedAt: null, revision: previous + 1 })]);
    expect(rooms.finishTracks()).toEqual([]);
    expect(snapshot().room.position).toBe(24);
    expect(playReady(rooms, "host", command()).position).toBe(0);
  });
});

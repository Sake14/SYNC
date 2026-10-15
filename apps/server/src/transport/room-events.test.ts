import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  membershipSchema, participantJoinedSchema, participantLeftSchema, playbackStateSchema,
  roomSnapshotSchema, syncPongSchema,
  type Ack, type ClientToServerEvents, type Membership, type ServerToClientEvents,
} from "@sync/shared";
import { parseConfig } from "../config.js";
import { RoomManager } from "../rooms/room-manager.js";
import { createServer } from "../server.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
function success<T>(result: Ack<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Unexpected command error: ${result.error.code}`);
  return result.data;
}
// Deliberately bypass compile-time safety to test hostile wire payloads.
function raw(client: Client, event: keyof ClientToServerEvents, payload: unknown): Promise<Ack<unknown>> {
  return (client as Socket).emitWithAck(event, payload);
}
function nextEvent<Key extends keyof ServerToClientEvents>(client: Client, event: Key) {
  return new Promise<Parameters<ServerToClientEvents[Key]>[0]>((resolve, reject) => {
    const rawClient = client as Socket;
    const timer = setTimeout(() => { rawClient.off(event as string, listener); reject(new Error(`Timed out waiting for ${event}`)); }, 2000);
    function listener(payload: Parameters<ServerToClientEvents[Key]>[0]) {
      clearTimeout(timer);
      resolve(payload);
    }
    rawClient.once(event as string, listener);
  });
}

describe("music rooms over Socket.IO", () => {
  let server: ReturnType<typeof createServer>;
  let rooms: RoomManager;
  let url: string;
  let time: number;
  const clients: Client[] = [];

  beforeEach(async () => {
    time = 10_000;
    rooms = new RoomManager({ maxParticipants: 3, reconnectGraceMs: 1000, emptyRoomTtlMs: 2000, now: () => time });
    server = createServer(parseConfig({}), rooms);
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server.close();
  });

  async function connect(): Promise<Client> {
    const client: Client = io(url, { autoConnect: false, reconnection: false, ackTimeout: 2000, transports: ["websocket"] });
    clients.push(client);
    const ready = nextEvent(client, "server:ready");
    client.connect();
    await ready;
    return client;
  }
  async function create(client: Client, displayName = "Host"): Promise<Membership> {
    return success(await client.emitWithAck("room:create", { displayName }));
  }
  async function join(client: Client, roomId: string, displayName = "Listener"): Promise<Membership> {
    return success(await client.emitWithAck("room:join", { roomId, displayName }));
  }
  async function snapshot(client: Client, roomId: string) {
    return success(await client.emitWithAck("room:snapshot", { roomId }));
  }
  async function command(client: Client, roomId: string) {
    return { roomId, expectedRevision: (await snapshot(client, roomId)).room.revision };
  }
  async function ready(client: Client, roomId: string) {
    const room = (await snapshot(client, roomId)).room;
    return success(await client.emitWithAck("player:ready", { roomId, trackId: room.trackId!, trackRevision: room.trackRevision, sequence: room.revision,
      status: "ready", bufferedSeconds: 24, soundUnlocked: true, clockSynced: true }));
  }
  async function playReady(client: Client, roomId: string) {
    for (const member of clients) {
      if (!member.connected) continue;
      const result = await member.emitWithAck("room:snapshot", {roomId});
      if (result.ok) await ready(member, roomId);
    }
    return success(await client.emitWithAck("player:play", await command(client, roomId)));
  }
  async function barrier(client: Client) {
    success(await client.emitWithAck("clock:ping", { clientSentAtMs: Date.now() }));
  }

  it("creates rooms and broadcasts validated membership snapshots without credentials", async () => {
    const host = await connect();
    const listener = await connect();
    const initial = await create(host, "  Host  ");
    expect(membershipSchema.safeParse(initial).success).toBe(true);
    const roomId = initial.snapshot.room.id;
    const added = nextEvent(host, "participant:joined");
    const changed = nextEvent(host, "room:snapshot");
    const ownSnapshot = nextEvent(listener, "room:snapshot");
    const joined = await join(listener, roomId);
    const event = await added;
    expect(participantJoinedSchema.safeParse(event).success).toBe(true);
    expect(event.participant.id).toBe(joined.participantId);
    expect(event.hostId).toBe(initial.participantId);
    expect(await changed).toEqual(joined.snapshot);
    expect(await ownSnapshot).toEqual(joined.snapshot);
    expect(joined.snapshot.room.participants.map((participant) => participant.displayName)).toEqual(["Host", "Listener"]);
    expect(roomSnapshotSchema.safeParse(joined.snapshot).success).toBe(true);
    const serialized = JSON.stringify(joined.snapshot);
    expect(serialized).not.toContain(initial.resumeToken);
    expect(serialized).not.toContain(joined.resumeToken);
    expect(serialized).not.toContain(host.id);
    expect((await join(listener, roomId)).snapshot.room.revision).toBe(joined.snapshot.room.revision);
  });

  it("changes track, plays, seeks and pauses identically for multiple clients", async () => {
    const host = await connect();
    const first = await connect();
    const second = await connect();
    const roomId = (await create(host)).snapshot.room.id;
    await join(first, roomId);
    await join(second, roomId);

    const trackEvent = nextEvent(first, "track:change");
    const track = success(await host.emitWithAck("track:change", { ...await command(host, roomId), trackId: "demo-track" }));
    expect(await trackEvent).toEqual(track);
    await Promise.all([barrier(first), barrier(second)]);
    const received = [nextEvent(first, "player:state"), nextEvent(second, "player:state")];
    const played = await playReady(host, roomId);
    expect(await Promise.all(received)).toEqual([played, played]);
    expect(playbackStateSchema.safeParse(played).success).toBe(true);
    expect(played).toMatchObject({ trackId: "demo-track", playbackState: "playing", startedAt: 10_750, position: 0 });
    time += 1500;
    const seek = success(await host.emitWithAck("player:seek", { ...await command(host, roomId), position: 42 }));
    expect(seek).toMatchObject({ position: 42, startedAt: 11_500, playbackState: "playing" });
    await barrier(second);
    time += 500;
    const pausedEvent = nextEvent(second, "player:state");
    const paused = success(await first.emitWithAck("player:pause", await command(first, roomId)));
    expect(await pausedEvent).toEqual(paused);
    expect(paused).toMatchObject({ position: 42.5, startedAt: null, playbackState: "paused" });
    expect((await snapshot(first, roomId)).room).toEqual((await snapshot(second, roomId)).room);
  });

  it("rejects HOST commands from listeners and all room operations from outsiders", async () => {
    const host = await connect();
    const listener = await connect();
    const outsider = await connect();
    const roomId = (await create(host)).snapshot.room.id;
    await join(listener, roomId);
    await create(outsider, "Other room host");
    const base = await command(host, roomId);
    const operations: [keyof ClientToServerEvents, unknown][] = [
      ["player:play", base],
      ["player:seek", { ...base, position: 10 }], ["track:change", { ...base, trackId: "track" }],
    ];
    const before = await snapshot(host, roomId);
    for (const [event, payload] of operations) {
      expect(await raw(listener, event, payload)).toMatchObject({ ok: false, error: { code: "NOT_HOST" } });
      expect(await raw(outsider, event, payload)).toMatchObject({ ok: false, error: { code: "NOT_MEMBER" } });
    }
    for (const [event, payload] of [
      ["room:snapshot", { roomId }], ["room:leave", base], ["player:pause", base], ["sync:ping", { roomId, clientSentAtMs: 1000 }],
    ] as [keyof ClientToServerEvents, unknown][]) {
      expect(await raw(outsider, event, payload)).toMatchObject({ ok: false, error: { code: "NOT_MEMBER" } });
    }
    expect(await snapshot(host, roomId)).toEqual(before);
  });

  it("isolates broadcasts by room and stops sending updates after explicit leave", async () => {
    const host = await connect();
    const listener = await connect();
    const other = await connect();
    const roomId = (await create(host)).snapshot.room.id;
    const member = await join(listener, roomId);
    await create(other);
    const otherStates: unknown[] = [];
    const departedStates: unknown[] = [];
    other.on("player:state", (state) => otherStates.push(state));
    listener.on("player:state", (state) => departedStates.push(state));
    const leftEvent = nextEvent(host, "participant:left");
    const left = success(await listener.emitWithAck("room:leave", await command(listener, roomId)));
    const event = await leftEvent;
    expect(participantLeftSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({ participantId: member.participantId, reason: "leave" });
    expect(left.room.participants).toHaveLength(1);
    success(await host.emitWithAck("track:change", { ...await command(host, roomId), trackId: "isolated" }));
    await Promise.all([barrier(other), barrier(listener)]);
    expect(otherStates).toEqual([]);
    expect(departedStates).toEqual([]);
    expect(await listener.emitWithAck("room:join", { roomId, resumeToken: member.resumeToken })).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
    expect(await listener.emitWithAck("room:snapshot", { roomId })).toMatchObject({ ok: false, error: { code: "NOT_MEMBER" } });
  });

  it("transfers HOST, notifies the removed member privately and prevents token reuse", async () => {
    const host = await connect(), listener = await connect(), witness = await connect();
    const original = await create(host);
    const roomId = original.snapshot.room.id;
    const member = await join(listener, roomId);
    await join(witness, roomId, "Witness");
    const roleEvent = nextEvent(witness, "room:snapshot");
    const transferred = success(await host.emitWithAck("room:transfer-host", {
      ...await command(host, roomId), participantId: member.participantId,
    }));
    expect((await roleEvent).room.hostId).toBe(member.participantId);
    expect(transferred.room.hostId).toBe(member.participantId);
    const publicEvents: unknown[] = [];
    witness.on("room:removed", event => publicEvents.push(event));
    const removed = nextEvent(host, "room:removed");
    const left = nextEvent(witness, "participant:left");
    const disconnected = new Promise(resolve => host.once("disconnect", resolve));
    const result = success(await listener.emitWithAck("room:kick", {
      ...await command(listener, roomId), participantId: original.participantId,
    }));
    expect(await removed).toMatchObject({ roomId, reason: "kicked", revision: result.room.revision });
    expect(await left).toMatchObject({ participantId: original.participantId, reason: "kick" });
    expect(await disconnected).toBe("io server disconnect");
    await barrier(witness);
    expect(publicEvents).toEqual([]);
    expect(result.room.participants).toHaveLength(2);
    const returner = await connect();
    expect(await returner.emitWithAck("room:join", { roomId, resumeToken: original.resumeToken })).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
    expect(await raw(listener, "room:kick", { ...await command(listener, roomId), participantId: 7 })).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
  });

  it("promotes HOST after a disconnect and restores a fresh snapshot after intervening changes", async () => {
    const oldHost = await connect();
    const newHost = await connect();
    const original = await create(oldHost);
    const roomId = original.snapshot.room.id;
    const replacement = await join(newHost, roomId);
    const left = nextEvent(newHost, "participant:left");
    oldHost.disconnect();
    expect(await left).toMatchObject({ participantId: original.participantId, hostId: replacement.participantId, reason: "disconnect" });
    success(await newHost.emitWithAck("track:change", { ...await command(newHost, roomId), trackId: "changed-while-offline" }));
    success(await newHost.emitWithAck("player:seek", { ...await command(newHost, roomId), position: 15 }));
    const playing = await playReady(newHost, roomId);
    time += 200;
    const reconnected = await connect();
    const restored = success(await reconnected.emitWithAck("room:join", { roomId, resumeToken: original.resumeToken }));
    expect(restored.participantId).toBe(original.participantId);
    expect(restored.resumed).toBe(true);
    expect(restored.snapshot.room).toMatchObject({ trackId: playing.trackId, position: 15, playbackState: "playing", startedAt: playing.startedAt, hostId: replacement.participantId });
    expect(restored.snapshot.room.revision).toBeGreaterThan(playing.revision);
    expect(restored.snapshot.serverTime).toBe(10_200);
    expect(await reconnected.emitWithAck("player:seek", { ...await command(reconnected, roomId), position: 0 })).toMatchObject({ ok: false, error: { code: "NOT_HOST" } });
  });

  it("replaces a still-open connection without duplicate participants or a false leave", async () => {
    const host = await connect();
    const listener = await connect();
    const original = await create(host);
    const roomId = original.snapshot.room.id;
    await join(listener, roomId);
    const oldCommand = await command(host, roomId);
    const leftEvents: unknown[] = [];
    listener.on("participant:left", (event) => leftEvents.push(event));
    const hostDisconnected = new Promise<string>((resolve) => host.once("disconnect", resolve));
    const returned = await connect();
    const resumed = success(await returned.emitWithAck("room:join", { roomId, resumeToken: original.resumeToken }));
    expect(await hostDisconnected).toBe("io server disconnect");
    await barrier(listener);
    expect(leftEvents).toEqual([]);
    expect(resumed.snapshot.room.participants).toHaveLength(2);
    expect(resumed.snapshot.room.hostId).toBe(original.participantId);
    expect(await returned.emitWithAck("track:change", { ...oldCommand, trackId: "stale" })).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect(success(await returned.emitWithAck("track:change", { ...await command(returned, roomId), trackId: "fresh" })).trackId).toBe("fresh");
  });

  it("rejoins on a new Socket.IO connection after a real transport interruption", async () => {
    const host = await connect();
    const witness = await connect();
    const original = await create(host);
    const roomId = original.snapshot.room.id;
    await join(witness, roomId);
    const left = nextEvent(witness, "participant:left");
    const oldSocketId = host.id;
    host.io.engine.close();
    await left;
    const ready = nextEvent(host, "server:ready");
    host.connect();
    await ready;
    expect(host.id).not.toBe(oldSocketId);
    const resumed = success(await host.emitWithAck("room:join", { roomId, resumeToken: original.resumeToken }));
    expect(resumed.participantId).toBe(original.participantId);
    expect(resumed.snapshot.room.participants).toHaveLength(2);
  });

  it("only accepts one concurrent command for a revision and rejects replay/future revisions", async () => {
    const host = await connect();
    const roomId = (await create(host)).snapshot.room.id;
    const base = await command(host, roomId);
    const results = await Promise.all([
      host.emitWithAck("track:change", { ...base, trackId: "first" }),
      host.emitWithAck("track:change", { ...base, trackId: "second" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results[1]).toMatchObject({ ok: false, error: { code: "STALE_REVISION", currentRevision: base.expectedRevision + 1 } });
    expect(await host.emitWithAck("track:change", { ...base, trackId: "replay" })).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect(await host.emitWithAck("player:play", { roomId, expectedRevision: 999 })).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect((await snapshot(host, roomId)).room.trackId).toBe("first");
  });

  it("enforces the participant limit under simultaneous joins and reconnect attempts", async () => {
    const host = await connect();
    const listeners = await Promise.all([connect(), connect(), connect()]);
    const original = await create(host);
    const roomId = original.snapshot.room.id;
    const results = await Promise.all(listeners.map((client) => client.emitWithAck("room:join", { roomId, displayName: "Listener" })));
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok)).toEqual([expect.objectContaining({ error: expect.objectContaining({ code: "ROOM_FULL" }) })]);
    const connected = listeners[results.findIndex((result) => result.ok)]!;
    const waiting = listeners[results.findIndex((result) => !result.ok)]!;
    const left = nextEvent(connected, "participant:left");
    host.disconnect();
    await left;
    await join(waiting, roomId);
    const returning = await connect();
    expect(await returning.emitWithAck("room:join", { roomId, resumeToken: original.resumeToken })).toMatchObject({ ok: false, error: { code: "ROOM_FULL" } });
    expect((await snapshot(connected, roomId)).room.participants).toHaveLength(3);
  });

  it("requires verified readiness reports and broadcasts them before a shared scheduled PLAY", async () => {
    const host = await connect(), listener = await connect();
    const roomId = (await create(host)).snapshot.room.id;
    await join(listener, roomId);
    const track = success(await host.emitWithAck("track:change", {...await command(host, roomId),trackId:"orbit"}));
    expect(await host.emitWithAck("player:play", await command(host,roomId))).toMatchObject({ok:false,error:{code:"NOT_READY"}});
    const invalid = {roomId,trackId:"orbit",trackRevision:track.trackRevision,sequence:1,status:"ready",bufferedSeconds:24,soundUnlocked:false,clockSynced:true};
    expect(await raw(listener,"player:ready",invalid)).toMatchObject({ok:false,error:{code:"INVALID_PAYLOAD"}});
    await ready(host,roomId);
    const changed=nextEvent(host,"room:snapshot"); await ready(listener,roomId);
    expect((await changed).room.participants.every(p=>p.readiness.status==="ready")).toBe(true);
    const received=nextEvent(listener,"player:state");
    const play=success(await host.emitWithAck("player:play",await command(host,roomId)));
    expect(await received).toEqual(play); expect(play.startedAt).toBe(time+750);
    const old=invalid;
    success(await host.emitWithAck("track:change",{...await command(host,roomId),trackId:"orbit"}));
    expect(await raw(listener,"player:ready",{...old,soundUnlocked:true})).toMatchObject({ok:false,error:{code:"STALE_REVISION"}});
  });

  it("returns scoped sync:pong to the requester, including the current revision", async () => {
    const host = await connect();
    const listener = await connect();
    const roomId = (await create(host)).snapshot.room.id;
    const joined = await join(listener, roomId);
    const otherPongs: unknown[] = [];
    listener.on("sync:pong", (pong) => otherPongs.push(pong));
    const pongEvent = nextEvent(host, "sync:pong");
    const clientSentAtMs = Date.now();
    const pong = success(await host.emitWithAck("sync:ping", { roomId, clientSentAtMs }));
    expect(await pongEvent).toEqual(pong);
    expect(syncPongSchema.safeParse(pong).success).toBe(true);
    expect(pong.revision).toBe(joined.snapshot.room.revision);
    expect(pong.serverReceivedAtMs).toBe(time);
    expect(pong.serverSentAtMs).toBeGreaterThanOrEqual(pong.serverReceivedAtMs);
    await barrier(listener);
    expect(otherPongs).toEqual([]);
  });

  it("rejects expired/fabricated credentials and returns ROOM_NOT_FOUND after room expiry", async () => {
    const host = await connect();
    const witness = await connect();
    const returning = await connect();
    const original = await create(host);
    const roomId = original.snapshot.room.id;
    const observer = await join(witness, roomId);
    expect(await returning.emitWithAck("room:join", { roomId, resumeToken: "X".repeat(32) })).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
    const left = nextEvent(witness, "participant:left");
    host.disconnect();
    await left;
    time += 1000;
    expect(await returning.emitWithAck("room:join", { roomId, resumeToken: original.resumeToken })).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
    success(await witness.emitWithAck("room:leave", await command(witness, roomId)));
    expect(await returning.emitWithAck("room:join", { roomId, resumeToken: observer.resumeToken })).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
    time += 2000;
    expect(await returning.emitWithAck("room:join", { roomId, displayName: "Late" })).toMatchObject({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
    expect(rooms.size).toBe(0);
  });

  it("rejects missing rooms without mutating other rooms", async () => {
    const client = await connect();
    const roomId = "missing-room";
    for (const [event, payload] of [
      ["room:join", { roomId, displayName: "Listener" }],
      ["room:snapshot", { roomId }], ["room:leave", { roomId, expectedRevision: 1 }],
      ["player:play", { roomId, expectedRevision: 1 }], ["player:pause", { roomId, expectedRevision: 1 }],
      ["player:seek", { roomId, expectedRevision: 1, position: 1 }],
      ["track:change", { roomId, expectedRevision: 1, trackId: "track" }],
      ["sync:ping", { roomId, clientSentAtMs: 1 }],
    ] as [keyof ClientToServerEvents, unknown][]) {
      expect(await raw(client, event, payload)).toMatchObject({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
    }
    expect(rooms.size).toBe(0);
  });

  it.each([
    ["room:create", { displayName: "  " }],
    ["room:create", { displayName: "Host", hostId: "spoofed" }],
    ["room:join", { roomId: "abcdefghij", displayName: "X", participantId: "spoofed" }],
    ["room:join", { roomId: "abcdefghij", resumeToken: "short" }],
    ["room:leave", { roomId: "abcdefghij" }],
    ["room:snapshot", { roomId: "../../private" }],
    ["player:play", { roomId: "abcdefghij", expectedRevision: 1, startedAt: 1 }],
    ["player:pause", { roomId: "abcdefghij", expectedRevision: -1 }],
    ["player:seek", { roomId: "abcdefghij", expectedRevision: 1, position: -1 }],
    ["player:seek", { roomId: "abcdefghij", expectedRevision: 1, position: Infinity }],
    ["track:change", { roomId: "abcdefghij", expectedRevision: 1, trackId: "https://untrusted.example/song.mp3" }],
    ["sync:ping", { roomId: "abcdefghij", clientSentAtMs: "123" }],
  ] as [keyof ClientToServerEvents, unknown][])("validates %s wire payload %j", async (event, payload) => {
    const client = await connect();
    expect(await raw(client, event, payload)).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
    expect(await raw(client, event, null)).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
    expect(rooms.size).toBe(0);
  });

  it("ignores missing/nonfunction acknowledgements and client-spoofed server events", async () => {
    const host = await connect();
    (host as Socket).emit("room:create", { displayName: "Ignored" });
    (host as Socket).emit("room:create", { displayName: "Ignored" }, { not: "a callback" });
    await barrier(host);
    expect(rooms.size).toBe(0);
    const original = await create(host);
    const roomId = original.snapshot.room.id;
    const listener = await connect();
    await join(listener, roomId);
    const before = await snapshot(host, roomId);
    (listener as Socket).emit("player:state", { roomId, trackId: "spoofed", revision: 999 });
    (listener as Socket).emit("participant:left", { roomId, participantId: original.participantId });
    (listener as Socket).emit("sync:pong", { roomId, revision: 999 });
    await barrier(listener);
    expect(await snapshot(host, roomId)).toEqual(before);
  });
});

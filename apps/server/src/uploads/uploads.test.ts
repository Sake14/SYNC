import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reactionSchema, uploadResponseSchema, type Ack, type Membership, type RoomSnapshot, type ClientToServerEvents, type ServerToClientEvents } from "@sync/shared";
import { parseConfig } from "../config.js";
import { RoomManager } from "../rooms/room-manager.js";
import { createServer } from "../server.js";
import { MusicCatalog } from "../catalog/catalog.js";
import { UploadStore } from "./upload-store.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
function success<T>(ack: Ack<T>): T { expect(ack.ok).toBe(true); if (!ack.ok) throw new Error(ack.error.code); return ack.data; }
describe("private room uploads and product Socket.IO events", () => {
  let fixtures: string, directory: string, wav: Buffer, server: ReturnType<typeof createServer>, rooms: RoomManager, store: UploadStore, url: string;
  let host: Membership, peer: Membership, other: Membership, a: Client, b: Client, outsider: Client;
  const clients: Client[] = [];
  beforeAll(async () => {
    fixtures = await mkdtemp(join(tmpdir(), "sync-demo-tests-"));
    await promisify(execFile)(process.execPath, ["scripts/generate-demo.mjs", fixtures]);
    wav = await readFile(join(fixtures, "orbit.wav"));
  });
  afterAll(async () => { await rm(fixtures, { recursive: true, force: true }); });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "sync-upload-tests-"));
    const config = parseConfig({ UPLOAD_DIR: directory });
    config.uploads.maxFileBytes = wav.length;
    config.uploads.maxRoomBytes = wav.length * 2;
    config.uploads.maxStorageBytes = wav.length * 4;
    rooms = new RoomManager({ getTrackDuration: () => undefined });
    store = new UploadStore(config.uploads);
    server = createServer(config, rooms, new MusicCatalog(), store);
    await new Promise<void>(resolve => server.httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
    async function connect() {
      const client: Client = io(url, { reconnection: false, transports: ["websocket"], ackTimeout: 2000 });
      clients.push(client);
      await new Promise<void>(resolve => client.once("server:ready", () => resolve()));
      return client;
    }
    a = await connect(); b = await connect(); outsider = await connect();
    host = success(await a.emitWithAck("room:create", { displayName: "А" }));
    peer = success(await b.emitWithAck("room:join", { roomId: host.snapshot.room.id, displayName: "Б" }));
    other = success(await outsider.emitWithAck("room:create", { displayName: "Другой" }));
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  function upload(token = peer.resumeToken, bytes = wav, mime = "audio/wav", filename = "music.wav") {
    return request(url).post(`/api/rooms/${host.snapshot.room.id}/uploads`).set("Connection", "keep-alive").set("Authorization", `Bearer ${token}`).set("X-Upload-Size", String(bytes.length)).attach("file", bytes, { filename, contentType: mime });
  }
  async function command(client = a) {
    const snapshot = success(await client.emitWithAck("room:snapshot", { roomId: host.snapshot.room.id }));
    return { roomId: snapshot.room.id, expectedRevision: snapshot.room.revision };
  }
  it("sniffs actual bytes, ignores hostile filenames/MIME, broadcasts library and streams Range to both members", async () => {
    const snapshots: RoomSnapshot[] = [];
    b.on("room:snapshot", snapshot => snapshots.push(snapshot));
    const response = await upload(peer.resumeToken, wav, "text/html", "../../escape.html").field("title", "Своя музыка").expect(201);
    const track = uploadResponseSchema.parse(response.body).track;
    expect(track.title).toBe("Своя музыка");
    expect(track.streamPath).toMatch(/^\/media\/room_[A-Za-z0-9_-]{12}_upload_[A-Za-z0-9_-]{32}\.wav$/);
    expect(await readdir(directory)).toEqual(expect.arrayContaining([track.streamPath.split("/").pop(), "tmp"]));
    expect(await readdir(store.tempDir)).toEqual([]);
    await b.emitWithAck("clock:ping", { clientSentAtMs: Date.now() });
    expect(snapshots.at(-1)?.room.library).toEqual([track]);
    for (const member of [host, peer]) {
      const media = await request(url).get(track.streamPath).set("Authorization", `Bearer ${member.resumeToken}`).set("Range", "bytes=0-43").expect(206);
      expect(media.headers["content-type"]).toContain("audio/wav");
      expect(media.headers["content-range"]).toBe(`bytes 0-43/${wav.length}`);
      expect(media.body).toEqual(wav.subarray(0, 44));
      await request(url).head(track.streamPath).set("Authorization", `Bearer ${member.resumeToken}`).expect(200);
    }
    expect((await request(url).get(track.streamPath).expect(401)).body.error.code).toBe("UNAUTHORIZED");
    await request(url).get(track.streamPath).set("Authorization", `Bearer ${"z".repeat(32)}`).expect(403);
    success(await a.emitWithAck("track:change", { ...await command(), trackId: track.id }));
    expect(success(await b.emitWithAck("room:snapshot", { roomId: host.snapshot.room.id })).room.trackId).toBe(track.id);
  });
  it("rejects forged audio, truncated WAV, arbitrary fields and excessive bytes; releases failed reservations", async () => {
    await upload(peer.resumeToken, Buffer.from("<html>Not audio</html>"), "audio/mpeg", "song.mp3").expect(415);
    await upload(peer.resumeToken, wav.subarray(0, 100)).expect(415);
    await upload().field("path", "/etc/passwd").expect(400);
    await upload(peer.resumeToken, Buffer.concat([wav, Buffer.alloc(1)])).expect(413);
    await upload().set("X-Upload-Size", "100").expect(413);
    expect(await readdir(store.tempDir)).toEqual([]);
    await upload().expect(201);
    await upload().expect(201);
    await upload().expect(413);
    expect(rooms.getSnapshot(a.id!, { roomId: host.snapshot.room.id }).room.library).toHaveLength(2);
  });
  it("requires active membership and revokes HTTP access on leave/disconnect", async () => {
    await request(url).post(`/api/rooms/${host.snapshot.room.id}/uploads`).set("Connection", "keep-alive").attach("file", wav, "x.wav").expect(401);
    await upload("z".repeat(32)).expect(403);
    const track = uploadResponseSchema.parse((await upload().expect(201)).body).track;
    success(await b.emitWithAck("room:leave", await command(b)));
    await request(url).get(track.streamPath).set("Authorization", `Bearer ${peer.resumeToken}`).expect(403);
    await upload().expect(403);
    a.disconnect();
    await new Promise(resolve => setTimeout(resolve, 20));
    await request(url).get(track.streamPath).set("Authorization", `Bearer ${host.resumeToken}`).expect(403);
  });
  it("restores library/queue on resume and refuses selecting another room's upload", async () => {
    const track = uploadResponseSchema.parse((await upload().expect(201)).body).track;
    success(await b.emitWithAck("queue:add", { ...await command(b), trackId: track.id }));
    expect(await outsider.emitWithAck("queue:add", { roomId: other.snapshot.room.id, expectedRevision: other.snapshot.room.revision, trackId: track.id })).toMatchObject({ ok: false, error: { code: "TRACK_NOT_FOUND" } });
    await request(url).get(track.streamPath).set("Authorization", `Bearer ${other.resumeToken}`).expect(403);
    const left = new Promise(resolve => a.once("participant:left", resolve));
    b.disconnect(); await left;
    const reconnected = new Promise<void>(resolve => b.once("server:ready", () => resolve())); b.connect(); await reconnected;
    const restored = success(await b.emitWithAck("room:join", { roomId: host.snapshot.room.id, resumeToken: peer.resumeToken }));
    expect(restored.resumed).toBe(true);
    expect(restored.snapshot.room.library).toEqual([track]);
    expect(restored.snapshot.room.queue[0]?.trackId).toBe(track.id);
    await request(url).get(track.streamPath).set("Authorization", `Bearer ${peer.resumeToken}`).expect(200);
  });
  it("broadcasts reactions to sender and peer only; validates emoji and membership", async () => {
    const receivedA: unknown[] = [], receivedB: unknown[] = [], receivedOther: unknown[] = [];
    a.on("reaction:received", value => receivedA.push(value)); b.on("reaction:received", value => receivedB.push(value)); outsider.on("reaction:received", value => receivedOther.push(value));
    const reaction = success(await b.emitWithAck("reaction:send", { roomId: host.snapshot.room.id, emoji: "🎧" }));
    expect(reactionSchema.safeParse(reaction).success).toBe(true);
    await Promise.all([a.emitWithAck("clock:ping", { clientSentAtMs: Date.now() }), outsider.emitWithAck("clock:ping", { clientSentAtMs: Date.now() })]);
    expect(receivedA).toEqual([reaction]); expect(receivedB).toEqual([reaction]); expect(receivedOther).toEqual([]);
    expect(await b.emitWithAck("reaction:send", { roomId: host.snapshot.room.id, emoji: "❤️" })).toMatchObject({ ok: false, error: { code: "RATE_LIMIT" } });
    expect(await outsider.emitWithAck("reaction:send", { roomId: host.snapshot.room.id, emoji: "🔥" })).toMatchObject({ ok: false, error: { code: "NOT_MEMBER" } });
    expect(await (b as Socket).emitWithAck("reaction:send", { roomId: host.snapshot.room.id, emoji: "bogus", participantId: host.participantId })).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
  });
  it("accounts for simultaneous quota reservations and frees room files after expiry", async () => {
    await store.prepare();
    const release = store.reserve(host.snapshot.room.id, wav.length);
    const second = store.reserve(host.snapshot.room.id, wav.length);
    expect(() => store.reserve(host.snapshot.room.id, 1)).toThrowError(expect.objectContaining({ code: "STORAGE_FULL" }));
    release(); release(); second();
    const track = uploadResponseSchema.parse((await upload().expect(201)).body).track;
    await store.sweep(() => false);
    expect(store.get(track.streamPath.split("/").pop()!)).toBeUndefined();
    expect(await readdir(directory)).toEqual(["tmp"]);
  });
  it("releases committed quota before responding even when temporary cleanup is delayed", async () => {
    let finishCleanup!: () => void;
    let markCleanupStarted!: () => void;
    const cleanupGate = new Promise<void>(resolve => { finishCleanup = resolve; });
    const cleanupStarted = new Promise<void>(resolve => { markCleanupStarted = resolve; });
    const discard = store.discardTemp.bind(store);
    const cleanup = vi.spyOn(store, "discardTemp").mockImplementationOnce(async path => {
      markCleanupStarted();
      await cleanupGate;
      await discard(path);
    });
    try {
      await upload().expect(201);
      await cleanupStarted;
      await upload().expect(201);
      await upload().expect(413);
      expect(rooms.getSnapshot(a.id!, { roomId: host.snapshot.room.id }).room.library).toHaveLength(2);
    } finally {
      finishCleanup();
      cleanup.mockRestore();
    }
  });
  it("cleans partial files and releases quota after a real upload cancellation", async () => {
    const boundary = "sync-test-boundary";
    const pending = httpRequest(`${url}/api/rooms/${host.snapshot.room.id}/uploads`, {
      method: "POST", headers: { Authorization: `Bearer ${peer.resumeToken}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "X-Upload-Size": String(wav.length) },
    });
    pending.on("error", () => {}); // Expected client-side error after intentional cancellation.
    pending.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
    pending.write(wav.subarray(0, 128_000));
    await expect.poll(async () => (await readdir(store.tempDir)).length).toBe(1);
    pending.destroy();
    await expect.poll(async () => (await readdir(store.tempDir)).length).toBe(0);
    expect(rooms.getSnapshot(a.id!, { roomId: host.snapshot.room.id }).room.library).toEqual([]);
    await upload().expect(201);
    await upload().expect(201);
  });
});

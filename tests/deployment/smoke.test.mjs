import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { test } from "node:test";
import { io } from "socket.io-client";
import { z } from "zod";
import { healthSchema, membershipSchema, roomSnapshotSchema, syncPongSchema, uploadResponseSchema } from "@sync/shared";
import { createDemoWav } from "../../scripts/generate-demo.mjs";

const config = z.object({
  url: z.url().refine(value => ["http:", "https:"].includes(new URL(value).protocol) && new URL(value).origin === value),
  maxRequestBytes: z.coerce.number().int().positive(),
}).parse({ url: process.env.SYNC_TEST_URL ?? "http://localhost:8080", maxRequestBytes: process.env.MAX_REQUEST_BYTES ?? 22020096 });
const ca = process.env.SYNC_TEST_CA ? await readFile(process.env.SYNC_TEST_CA) : undefined;

// TLS validation stays enabled. The local TLS test supplies only its public CA certificate.
function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.url);
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method, headers, ca }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("HTTP check timed out")));
    req.end(body);
  });
}
function socket(transports, origin = config.url) {
  return io(config.url, { autoConnect: false, forceNew: true, transports, reconnection: false, timeout: 5000, ca, extraHeaders: { Origin: origin } });
}
async function connect(client) {
  const ready = once(client, "connect");
  const failed = once(client, "connect_error").then(() => { throw new Error("Socket.IO connection failed"); });
  client.connect();
  await Promise.race([ready, failed]);
}
function success(ack) {
  // Never include a membership or its resumeToken in failed assertion output.
  assert.equal(ack.ok, true, "Room command rejected");
  return ack.data;
}

test("HTTP front page, backend health, Next.js proxy health and audio Range", async () => {
  assert.equal((await request("/")).status, 200);
  for (const path of ["/health", "/api/health"]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(healthSchema.parse(JSON.parse(response.body)).status, "ok");
  }
  const range = await request("/media/orbit.wav", { headers: { Range: "bytes=0-43" } });
  assert.equal(range.status, 206);
  assert.equal(range.body.length, 44);
  assert.equal(range.body.toString("ascii", 0, 4), "RIFF");
  assert.match(range.headers["content-range"], /^bytes 0-43\//);
  assert.equal((await request("/media/orbit.wav", { method: "HEAD" })).status, 200);
});

test("proxy rejects declared oversize bodies before forwarding", async () => {
  const body = Buffer.alloc(config.maxRequestBytes + 1);
  const response = await request("/api/rooms/aaaaaaaaaaaa/uploads", {
    method: "POST", headers: { "Content-Length": String(body.length) }, body,
  });
  assert.equal(response.status, 413);
});

test("Socket.IO long polling upgrades to WebSocket through the proxy", async () => {
  const client = socket(["polling", "websocket"]);
  try {
    await connect(client);
    if (client.io.engine.transport.name !== "websocket") await once(client.io.engine, "upgrade", { signal: AbortSignal.timeout(5000) });
    assert.equal(client.io.engine.transport.name, "websocket");
  } finally { client.disconnect(); }
});

test("Socket.IO refuses an unlisted browser Origin (including WebSocket)", async () => {
  for (const transport of ["polling", "websocket"]) {
    const client = socket([transport], "https://untrusted.example");
    try {
      const failed = once(client, "connect_error");
      client.connect();
      await failed;
      assert.equal(client.connected, false);
    } finally { client.disconnect(); }
  }
});

test("two real WebSocket clients join, exchange timestamps, upload private audio and receive leave", async () => {
  const host = socket(["websocket"]);
  const peer = socket(["websocket"]);
  try {
    await Promise.all([connect(host), connect(peer)]);
    const membership = membershipSchema.parse(success(await host.timeout(5000).emitWithAck("room:create", { displayName: "Docker host" })));
    const roomId = membership.snapshot.room.id;
    const joined = membershipSchema.parse(success(await peer.timeout(5000).emitWithAck("room:join", { roomId, displayName: "Docker peer" })));
    const snapshot = roomSnapshotSchema.parse(success(await host.timeout(5000).emitWithAck("room:snapshot", { roomId })));
    assert.equal(snapshot.room.participants.length, 2);
    const now = Date.now();
    const pong = syncPongSchema.parse(success(await peer.timeout(5000).emitWithAck("sync:ping", { roomId, clientSentAtMs: now })));
    assert.equal(pong.clientSentAtMs, now);
    assert.ok(pong.serverSentAtMs >= pong.serverReceivedAtMs);

    const form = new FormData();
    const wav = createDemoWav({ seconds: 1 });
    form.set("file", new Blob([wav], { type: "audio/wav" }), "original.wav");
    form.set("title", "Docker recording");
    const multipart = new Request(config.url, { method: "POST", body: form });
    const body = Buffer.from(await multipart.arrayBuffer());
    const headers = { Authorization: "Bearer " + joined.resumeToken, "Content-Type": multipart.headers.get("content-type"), "Content-Length": String(body.length), "X-Upload-Size": String(wav.length), "X-Forwarded-Proto": "https" };
    const uploaded = await request("/api/rooms/" + roomId + "/uploads", { method: "POST", headers, body });
    assert.equal(uploaded.status, 201);
    const track = uploadResponseSchema.parse(JSON.parse(uploaded.body)).track;
    const cookie = uploaded.headers["set-cookie"]?.[0];
    assert.ok(cookie, "Private media cookie must be set");
    // Boolean assertions keep private cookie values out of failure diagnostics.
    assert.ok(/HttpOnly/i.test(cookie));
    assert.ok(/SameSite=strict/i.test(cookie));
    assert.ok(/Path=\/media/i.test(cookie));
    assert.equal(/;\s*Secure/i.test(cookie), new URL(config.url).protocol === "https:");
    assert.equal((await request(track.streamPath)).status, 401);
    const privateRange = await request(track.streamPath, { headers: { Cookie: cookie.split(";")[0], Range: "bytes=0-43" } });
    assert.equal(privateRange.status, 206);
    assert.deepEqual(privateRange.body, wav.subarray(0, 44));
    const library = roomSnapshotSchema.parse(success(await host.timeout(5000).emitWithAck("room:snapshot", { roomId })));
    assert.ok(library.room.library.some(entry => entry.id === track.id));

    // Verify that the application's stricter file limit is still enforced.
    const tooLarge = await request("/api/rooms/" + roomId + "/uploads", {
      method: "POST", headers: { Authorization: "Bearer " + joined.resumeToken, "X-Upload-Size": "52428801" },
    });
    assert.equal(tooLarge.status, 413);

    const left = once(host, "participant:left", { signal: AbortSignal.timeout(5000) });
    peer.disconnect();
    await left;
    const remaining = roomSnapshotSchema.parse(success(await host.timeout(5000).emitWithAck("room:snapshot", { roomId })));
    assert.equal(remaining.room.participants.length, 1);
  } finally { host.disconnect(); peer.disconnect(); }
});

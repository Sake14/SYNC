import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { clockPongSchema, readySchema, type ClientToServerEvents, type ServerToClientEvents } from "@sync/shared";
import { parseConfig } from "./config.js";
import { createServer } from "./server.js";

describe("Socket.IO transport", () => {
  const server = createServer(parseConfig({}));
  const clients: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];
  let url: string;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(() => { for (const client of clients.splice(0)) client.disconnect(); });
  afterAll(async () => { await server.close(); });

  async function connect() {
    const client: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, { autoConnect: false, reconnection: false });
    clients.push(client);
    const ready = new Promise<unknown>((resolve, reject) => {
      client.once("server:ready", resolve);
      client.once("connect_error", reject);
    });
    client.connect();
    expect(readySchema.safeParse(await ready).success).toBe(true);
    return client;
  }

  it("connects and returns a timestamped clock acknowledgement", async () => {
    const client = await connect();
    const sent = Date.now();
    const result = await client.timeout(2000).emitWithAck("clock:ping", { clientSentAtMs: sent });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful clock sample");
    expect(clockPongSchema.safeParse(result.data).success).toBe(true);
    expect(result.data.clientSentAtMs).toBe(sent);
    expect(result.data.serverReceivedAtMs).toBeGreaterThanOrEqual(sent);
    expect(result.data.serverSentAtMs).toBeGreaterThanOrEqual(result.data.serverReceivedAtMs);
  });
  it("rejects malformed input and survives missing acknowledgement callbacks", async () => {
    const client = await connect();
    // @ts-expect-error Test untrusted network input, not the TypeScript contract.
    const result = await client.timeout(2000).emitWithAck("clock:ping", null);
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
    // @ts-expect-error A malicious client can omit the ack callback.
    client.emit("clock:ping", null);
    expect((await client.timeout(2000).emitWithAck("clock:ping", { clientSentAtMs: 1 })).ok).toBe(true);
  });
  it("rejects WebSocket handshakes from unconfigured browser origins", async () => {
    const client = io(url, { autoConnect: false, reconnection: false, transports: ["websocket"], extraHeaders: { Origin: "https://untrusted.example" } });
    clients.push(client);
    const failure = new Promise<Error>((resolve) => client.once("connect_error", resolve));
    client.connect();
    expect(await failure).toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });
});

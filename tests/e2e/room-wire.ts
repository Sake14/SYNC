import { expect, type Page, type WebSocketRoute } from "@playwright/test";
import { playbackStateSchema, roomSnapshotSchema, type PlaybackState, type Room } from "@sync/shared";

/** Observe actual public events. Private acknowledgements/credentials are never retained. */
export class RoomWire {
  readonly snapshots = new Map<number, Room>();
  readonly playback = new Map<number, PlaybackState>();
  invalidMessages = 0;
  private interrupted = false;
  private readonly connections = new Set<{ client: WebSocketRoute; server: WebSocketRoute }>();

  async attach(page: Page) {
    await page.route("**/socket.io/**", route => this.interrupted ? route.abort("internetdisconnected") : route.continue());
    await page.routeWebSocket("**/socket.io/**", client => {
      if (this.interrupted) { void client.close(); return; }
      const server = client.connectToServer();
      this.connections.add({ client, server });
      server.onMessage(message => {
        if (this.interrupted) return;
        this.observe(message);
        client.send(message);
      });
    });
  }

  private observe(message: string | Buffer) {
    const frame = message.toString();
    // Engine.IO message + Socket.IO event, default namespace. Ignore private ACK (43).
    if (!frame.startsWith("42")) return;
    try {
      const event: unknown = JSON.parse(frame.slice(2));
      if (!Array.isArray(event)) return;
      if (event[0] === "room:snapshot") {
        const parsed = roomSnapshotSchema.safeParse(event[1]);
        if (!parsed.success) { this.invalidMessages++; return; }
        this.snapshots.set(parsed.data.room.revision, parsed.data.room);
        if (this.snapshots.size > 64) this.snapshots.delete(this.snapshots.keys().next().value!);
      }
      if (event[0] === "player:state") {
        const parsed = playbackStateSchema.safeParse(event[1]);
        if (!parsed.success) { this.invalidMessages++; return; }
        this.playback.set(parsed.data.revision, parsed.data);
        if (this.playback.size > 64) this.playback.delete(this.playback.keys().next().value!);
      }
    } catch { this.invalidMessages++; }
  }

  async interrupt() {
    this.interrupted = true;
    const active = [...this.connections];
    this.connections.clear();
    await Promise.all(active.flatMap(({ client, server }) => [
      client.close({ code: 4000, reason: "Audit transport interruption" }),
      server.close({ code: 4000, reason: "Audit transport interruption" }),
    ]));
  }

  restore() { this.interrupted = false; }
}

export async function matchingRoom(first: RoomWire, second: RoomWire, predicate: (room: Room) => boolean) {
  let found: Room | undefined;
  await expect.poll(() => {
    const revision = [...first.snapshots.keys()].sort((a, b) => b - a)
      .find(revision => predicate(first.snapshots.get(revision)!) && second.snapshots.has(revision));
    if (revision === undefined) return false;
    const a = first.snapshots.get(revision)!;
    const b = second.snapshots.get(revision)!;
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
    found = a;
    return true;
  }, { message: "Both browsers must receive the same real room snapshot" }).toBe(true);
  return found!;
}

export async function matchingPlayback(first: RoomWire, second: RoomWire, predicate: (state: PlaybackState) => boolean) {
  let found: PlaybackState | undefined;
  await expect.poll(() => {
    const revision = [...first.playback.keys()].sort((a, b) => b - a)
      .find(revision => predicate(first.playback.get(revision)!) && second.playback.has(revision));
    if (revision === undefined) return false;
    const a = first.playback.get(revision)!;
    const b = second.playback.get(revision)!;
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
    found = a;
    return true;
  }, { message: "Both browsers must receive identical playback anchors and revisions" }).toBe(true);
  return found!;
}

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ProviderResult, type Track } from "@sync/shared";
import { loadCatalog, type MusicCatalog } from "../catalog/catalog.js";
import { createApp } from "../app.js";
import { parseConfig } from "../config.js";
import { RoomManager } from "../rooms/room-manager.js";
import { UploadStore } from "../uploads/upload-store.js";
import { LocalMusicProvider } from "./local-music-provider.js";
import { createMusicProviders } from "./registry.js";

function value<T>(result: ProviderResult<T>): T {
  expect(result.status).toBe("OK");
  if (result.status !== "OK") throw new Error(result.status);
  return result.data;
}
describe("LocalMusicProvider", () => {
  let directory: string, catalog: MusicCatalog, provider: LocalMusicProvider;
  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), "sync-local-provider-"));
    await promisify(execFile)(process.execPath, ["scripts/generate-demo.mjs", directory]);
    catalog = await loadCatalog(directory); provider = new LocalMusicProvider(catalog);
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  it("reads real metadata and searches title/artist with limits and an empty query", async () => {
    expect(value(await provider.getUserLibrary())).toHaveLength(3);
    expect(value(await provider.searchTracks({ query: "  ORBIT " }))).toEqual([{ provider: "local", id: "orbit", title: "Orbit", artist: "SYNC Originals", durationSeconds: 24 }]);
    expect(value(await provider.searchTracks({ query: "SYNC ORIGINALS", limit: 2 }))).toHaveLength(2);
    expect(value(await provider.searchTracks({ query: "", limit: 1 }))).toHaveLength(1);
    expect(value(await provider.searchTracks({ query: "missing" }))).toEqual([]);
    expect(value(await provider.getPlaylists())).toEqual([]);
  });
  it("resolves the existing HTTP media without external URLs and preserves Range playback", async () => {
    const playback = value(await provider.resolvePlayback("orbit"));
    expect(playback).toEqual({ kind: "local-http", provider: "local", streamPath: "/media/orbit.wav", durationSeconds: 24 });
    const bytes = await request(createApp(parseConfig({}), catalog)).get(playback.streamPath).set("Range", "bytes=0-43").expect(206);
    expect(bytes.body).toEqual((await readFile(resolve(directory, "orbit.wav"))).subarray(0, 44));
    expect(value(await provider.getTrack("orbit"))).not.toHaveProperty("streamPath");
  });
  it("validates inputs and cannot resolve arbitrary paths, URLs or unknown tracks", async () => {
    for (const id of ["../private", "https://zvuk.com/track/42", ""]) {
      expect(await provider.getTrack(id)).toMatchObject({ status: "INVALID_INPUT" });
      expect(await provider.resolvePlayback(id)).toMatchObject({ status: "INVALID_INPUT" });
    }
    expect(await provider.resolvePlayback("missing")).toMatchObject({ status: "NOT_FOUND" });
    expect(await provider.searchTracks({ query: "Orbit", limit: 51 })).toMatchObject({ status: "INVALID_INPUT" });
  });
  it("authorizes private room libraries before searching or resolving uploaded tracks", async () => {
    const rooms = new RoomManager();
    const membership = rooms.create("a", { displayName: "А" }).membership;
    const id = membership.snapshot.room.id;
    const upload: Track = { id: "upload_local", title: "Моя запись", artist: "А", durationSeconds: 8, streamPath: "/media/upload_local.wav" };
    rooms.addLibraryTrack("a", id, upload);
    const local = createMusicProviders(catalog, rooms).local;
    const context = { localRoom: { roomId: id, connectionId: "a" } };
    expect(value(await local.searchTracks({ query: "МОЯ" }, context))[0]).toMatchObject({ id: upload.id, provider: "local" });
    expect(value(await local.resolvePlayback(upload.id, context)).durationSeconds).toBe(8);
    expect(await local.resolvePlayback(upload.id)).toMatchObject({ status: "NOT_FOUND" });
    expect(await local.getUserLibrary({ localRoom: { roomId: id, connectionId: "outsider" } })).toMatchObject({ status: "ACCESS_DENIED" });
    rooms.disconnect("a");
    expect(await local.getTrack("orbit", context)).toMatchObject({ status: "ACCESS_DENIED" });
  });
  it("exposes provider HTTP routes without changing the legacy catalog or media contract", async () => {
    const rooms = new RoomManager(), config = parseConfig({});
    const membership = rooms.create("a", { displayName: "А" }).membership;
    const id = membership.snapshot.room.id;
    rooms.addLibraryTrack("a", id, { id: "upload_private", title: "Запись", artist: "А", durationSeconds: 2, streamPath: "/media/private.wav" });
    const app = createApp(config, catalog, { rooms, uploads: new UploadStore(config.uploads), broadcast: () => {} });
    expect((await request(app).get("/api/catalog").expect(200)).body).toEqual({ tracks: catalog.list() });
    expect((await request(app).get("/api/music/local/search?q=orbit").expect(200)).body.data[0].id).toBe("orbit");
    await request(app).get("/api/music/local/search?q=x&limit=100").expect(400);
    await request(app).get("/api/music/local/library?connectionId=a").expect(400);
    await request(app).get(`/api/music/local/library?roomId=${id}`).expect(403);
    const library = await request(app).get(`/api/music/local/library?roomId=${id}`).set("Authorization", `Bearer ${membership.resumeToken}`).expect(200);
    expect(library.body.data).toHaveLength(4);
    expect(JSON.stringify(library.body)).not.toContain(membership.resumeToken);
    expect((await request(app).get("/api/music/local/playlists").expect(200)).body.data).toEqual([]);
    expect((await request(app).get("/api/music/local/tracks/orbit/playback").expect(200)).body.data.streamPath).toBe("/media/orbit.wav");
    await request(app).get("/api/music/local/tracks/missing").expect(404);
    const result = await request(app).get("/api/music/zvuk/tracks/5896627/playback").expect(501);
    expect(result.body).toMatchObject({ status: "UNSUPPORTED", officialUrl: "https://zvuk.com/track/5896627" });
    expect(result.body).not.toHaveProperty("data");
    await request(app).get(`/api/music/zvuk/library?roomId=${id}`).set("Authorization", `Bearer ${membership.resumeToken}`).expect(400);
    const providers = await request(app).get("/api/music/providers").expect(200);
    expect(providers.body.providers[1].capabilities.resolvePlayback).toBe(false);
  });
});

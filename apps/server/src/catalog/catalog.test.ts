import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog.js";
import { createApp } from "../app.js";
import { parseConfig } from "../config.js";

describe("local music catalog and HTTP audio", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), "sync-media-"));
    await promisify(execFile)(process.execPath, [
      "scripts/generate-demo.mjs",
      directory,
    ]);
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("inspects real WAV duration and tags; generator preserves existing files", async () => {
    const catalog = await loadCatalog(directory);
    expect(catalog.list()).toHaveLength(3);
    expect(catalog.list().find((track) => track.id === "orbit")).toMatchObject({
      title: "Orbit",
      artist: "SYNC Originals",
      durationSeconds: 24,
    });
    const before = await readFile(resolve(directory, "orbit.wav"));
    await promisify(execFile)(process.execPath, [
      "scripts/generate-demo.mjs",
      directory,
    ]);
    expect(await readFile(resolve(directory, "orbit.wav"))).toEqual(before);
  });
  it("serves inspected audio, byte ranges, HEAD and rejects impossible ranges", async () => {
    const app = createApp(parseConfig({}), await loadCatalog(directory));
    const full = await request(app).get("/media/orbit.wav").expect(200);
    expect(full.headers["content-type"]).toMatch(/audio\/wav/);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    const size = Number(full.headers["content-length"]);
    const partial = await request(app)
      .get("/media/orbit.wav")
      .set("Range", "bytes=0-43")
      .expect(206);
    expect(partial.headers["content-range"]).toBe(`bytes 0-43/${size}`);
    expect(Number(partial.headers["content-length"])).toBe(44);
    const head = await request(app).head("/media/orbit.wav").expect(200);
    expect(Number(head.headers["content-length"])).toBe(size);
    await request(app)
      .get("/media/orbit.wav")
      .set("Range", `bytes=${size + 1}-`)
      .expect(416);
  });
  it("never exposes sidecars, unknown audio or symlinks outside the directory", async () => {
    await writeFile(resolve(directory, "private.txt"), "private");
    await symlink(
      resolve(directory, "private.txt"),
      resolve(directory, "linked.wav"),
    );
    const app = createApp(parseConfig({}), await loadCatalog(directory));
    await request(app).get("/media/private.txt").expect(404);
    await request(app).get("/media/linked.wav").expect(404);
    await request(app).get("/media/unknown.mp3").expect(404);
    await request(app).get("/media/..%2Fprivate.txt").expect(404);
  });
  it("uses validated optional metadata and fails on invalid sidecars", async () => {
    await writeFile(
      resolve(directory, "catalog.json"),
      JSON.stringify({
        tracks: [
          { id: "orbit", title: "Свой трек", artist: "Автор", cover: "pulse" },
        ],
      }),
    );
    expect(
      (await loadCatalog(directory)).list().find((t) => t.id === "orbit"),
    ).toMatchObject({ title: "Свой трек", artist: "Автор", cover: "pulse" });
    await writeFile(
      resolve(directory, "catalog.json"),
      JSON.stringify({
        tracks: [{ id: "../escape", title: "A", artist: "B" }],
      }),
    );
    await expect(loadCatalog(directory)).rejects.toThrow(
      "Invalid media/catalog.json",
    );
  });
});

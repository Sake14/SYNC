import { readdir, readFile, realpath } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { parseFile } from "music-metadata";
import { trackSchema, type Track } from "@sync/shared";
import { z } from "zod";

const metadataSchema = z.strictObject({
  tracks: z.array(
    z.strictObject({
      id: trackSchema.shape.id,
      title: trackSchema.shape.title,
      artist: trackSchema.shape.artist,
      cover: trackSchema.shape.cover,
    }),
  ),
});

/** Only inspected local audio is exposed. Never accepts arbitrary paths from HTTP. */
export class MusicCatalog {
  constructor(
    private readonly entries: { track: Track; file: string }[] = [],
  ) {}
  list(): Track[] {
    return this.entries.map(({ track }) => ({ ...track }));
  }
  file(streamPath: string): string | undefined {
    return this.entries.find(({ track }) => track.streamPath === streamPath)
      ?.file;
  }
  duration(id: string): number | undefined {
    return this.entries.find(({ track }) => track.id === id)?.track
      .durationSeconds;
  }
}

export async function loadCatalog(mediaDir: string): Promise<MusicCatalog> {
  let directory: string;
  try {
    directory = await realpath(mediaDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new MusicCatalog();
    throw error;
  }
  let metadata: z.infer<typeof metadataSchema>["tracks"] = [];
  try {
    metadata = metadataSchema.parse(
      JSON.parse(await readFile(resolve(directory, "catalog.json"), "utf8")),
    ).tracks;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Invalid media/catalog.json");
  }
  const entries: { track: Track; file: string }[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (
      !entry.isFile() ||
      !/^[A-Za-z0-9_-]{1,128}\.(mp3|wav|ogg|m4a)$/.test(entry.name)
    )
      continue;
    const file = await realpath(resolve(directory, entry.name));
    if (dirname(file) !== directory) continue;
    const id = basename(entry.name).replace(/\.[^.]+$/, "");
    if (entries.some((item) => item.track.id === id))
      throw new Error("Duplicate audio IDs in media directory");
    try {
      const parsed = await parseFile(file, {
        duration: true,
        skipCovers: true,
      });
      const overrides = metadata.find((item) => item.id === id);
      const track = trackSchema.parse({
        id,
        title: overrides?.title ?? parsed.common.title ?? id.replace(/-/g, " "),
        artist: overrides?.artist ?? parsed.common.artist ?? "Локальный трек",
        durationSeconds: parsed.format.duration,
        streamPath: `/media/${entry.name}`,
        cover:
          overrides?.cover ??
          (["orbit", "bloom", "pulse"] as const)[entries.length % 3],
      });
      entries.push({ file, track });
    } catch {
      console.warn(`Skipped unreadable audio: ${entry.name}`);
    }
  }
  return new MusicCatalog(entries);
}

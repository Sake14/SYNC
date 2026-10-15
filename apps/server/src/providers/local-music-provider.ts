import { z } from "zod";
import {
  providerSearchSchema, providerTrackSchema, localPlaybackSchema, trackSchema,
  type MusicProvider, type MusicProviderContext, type MusicProviderInfo, type ProviderTrack,
  type ProviderResult, type ProviderPlaylist, type LocalPlayback, type ProviderSearchInput, type Track,
} from "@sync/shared";
import { MusicCatalog } from "../catalog/catalog.js";
import { failure } from "./results.js";

type RoomLibrary = (scope: NonNullable<MusicProviderContext["localRoom"]>) => Track[];
const roomScopeSchema = z.strictObject({ roomId: z.string().regex(/^[A-Za-z0-9_-]{10,32}$/), connectionId: z.string().min(1).max(256) });
function metadata(track: Track): ProviderTrack {
  const { id, title, artist, durationSeconds } = track;
  return providerTrackSchema.parse({ provider: "local", id, title, artist, durationSeconds });
}

/** Adapts the existing HTTP catalog; has no dependency on Zvuk or external networking. */
export class LocalMusicProvider implements MusicProvider {
  readonly info: MusicProviderInfo = {
    id: "local", name: "Local Music", mode: "local",
    capabilities: { searchTracks: true, getTrack: true, getUserLibrary: true, getPlaylists: true, resolvePlayback: true },
  };
  constructor(private readonly catalog: MusicCatalog, private readonly roomLibrary?: RoomLibrary) {}

  private tracks(context?: MusicProviderContext): ProviderResult<Track[]> {
    try {
      const scope = context?.localRoom ? roomScopeSchema.parse(context.localRoom) : undefined;
      if (scope && !this.roomLibrary) return failure("ACCESS_DENIED");
      const tracks = [...this.catalog.list(), ...(scope ? this.roomLibrary!(scope) : [])];
      const unique = new Map(tracks.map(track => [track.id, trackSchema.parse(track)]));
      return { status: "OK", data: [...unique.values()] };
    } catch {
      // No room credentials, filesystem paths or raw exception text leave this boundary.
      return failure("ACCESS_DENIED");
    }
  }
  async searchTracks(input: ProviderSearchInput, context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack[]>> {
    const parsed = providerSearchSchema.safeParse(input);
    if (!parsed.success) return failure("INVALID_INPUT");
    const library = this.tracks(context);
    if (library.status !== "OK") return library;
    const query = parsed.data.query.normalize("NFKC").toLocaleLowerCase("ru");
    return { status: "OK", data: library.data.filter(track => `${track.title} ${track.artist}`.normalize("NFKC").toLocaleLowerCase("ru").includes(query)).slice(0, parsed.data.limit).map(metadata) };
  }
  async getTrack(trackId: string, context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack>> {
    if (!trackSchema.shape.id.safeParse(trackId).success) return failure("INVALID_INPUT");
    const library = this.tracks(context);
    if (library.status !== "OK") return library;
    const track = library.data.find(item => item.id === trackId);
    return track ? { status: "OK", data: metadata(track) } : failure("NOT_FOUND");
  }
  async getUserLibrary(context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack[]>> {
    const library = this.tracks(context);
    return library.status === "OK" ? { status: "OK", data: library.data.map(metadata) } : library;
  }
  async getPlaylists(context?: MusicProviderContext): Promise<ProviderResult<ProviderPlaylist[]>> {
    const library = this.tracks(context);
    // MVP has a shared room queue, but no saved playlist entities. Do not invent one.
    return library.status === "OK" ? { status: "OK", data: [] } : library;
  }
  async resolvePlayback(trackId: string, context?: MusicProviderContext): Promise<ProviderResult<LocalPlayback>> {
    if (!trackSchema.shape.id.safeParse(trackId).success) return failure("INVALID_INPUT");
    const library = this.tracks(context);
    if (library.status !== "OK") return library;
    const track = library.data.find(item => item.id === trackId);
    return track ? { status: "OK", data: localPlaybackSchema.parse({ kind: "local-http", provider: "local", streamPath: track.streamPath, durationSeconds: track.durationSeconds }) } : failure("NOT_FOUND");
  }
}

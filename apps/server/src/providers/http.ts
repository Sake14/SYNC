import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  musicProviderIdSchema, musicProvidersSchema, providerResultSchema, providerTrackSchema, providerPlaylistSchema,
  localPlaybackSchema, roomIdSchema, roomAccessSchema, type MusicProviderContext, type ProviderResult,
} from "@sync/shared";
import type { RoomManager } from "../rooms/room-manager.js";
import type { MusicProviders } from "./registry.js";
import { failure, providerHttpStatus } from "./results.js";

const scopeQuery = z.strictObject({ roomId: roomIdSchema.optional() });
const searchQuery = scopeQuery.extend({ q: z.string().trim().max(200).default(""), limit: z.coerce.number().int().min(1).max(50).default(20) });
function respond<T>(res: Response, result: ProviderResult<T>, schema: z.ZodType<T>) {
  const parsed = providerResultSchema(schema).safeParse(result);
  if (!parsed.success) { res.status(502).json(failure("INVALID_RESPONSE")); return; }
  const value = parsed.data;
  if (value.status === "RATE_LIMITED" && value.retryAfterSeconds !== undefined) res.setHeader("Retry-After", value.retryAfterSeconds);
  res.status(value.status === "OK" ? 200 : providerHttpStatus[value.status]).json(value);
}
export function bindMusicProviderRoutes(app: Express, providers: MusicProviders, rooms?: RoomManager) {
  function context(req: Request, roomId: string | undefined): MusicProviderContext | undefined {
    if (!roomId) return;
    // SYNC credentials authorize local uploads only. They are never forwarded as Zvuk credentials.
    const access = roomAccessSchema.safeParse({ roomId, resumeToken: req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32})$/)?.[1] });
    if (!access.success || !rooms) throw new Error("No local membership");
    return { localRoom: { roomId, connectionId: rooms.authorizeToken(roomId, access.data.resumeToken) } };
  }
  app.get("/api/music/providers", (_req, res) => res.json(musicProvidersSchema.parse({ providers: [providers.local.info, providers.zvuk.info] })));
  app.get("/api/music/:provider/search", async (req, res) => {
    const provider = musicProviderIdSchema.safeParse(req.params.provider), query = searchQuery.safeParse(req.query);
    if (!provider.success || !query.success || (provider.data === "zvuk" && query.data.roomId)) { res.status(400).json(failure("INVALID_INPUT")); return; }
    try { respond(res, await providers[provider.data].searchTracks({ query: query.data.q, limit: query.data.limit }, context(req, query.data.roomId)), z.array(providerTrackSchema)); }
    catch { res.status(403).json(failure("ACCESS_DENIED")); }
  });
  for (const operation of ["library", "playlists", "tracks/:trackId", "tracks/:trackId/playback"] as const) {
    app.get<{ provider: string; trackId?: string }>(`/api/music/:provider/${operation}`, async (req, res) => {
      const provider = musicProviderIdSchema.safeParse(req.params.provider), query = scopeQuery.safeParse(req.query);
      if (!provider.success || !query.success || (provider.data === "zvuk" && query.data.roomId)) { res.status(400).json(failure("INVALID_INPUT")); return; }
      try {
        const scope = context(req, query.data.roomId), source = providers[provider.data];
        if (operation === "library") respond(res, await source.getUserLibrary(scope), z.array(providerTrackSchema));
        else if (operation === "playlists") respond(res, await source.getPlaylists(scope), z.array(providerPlaylistSchema));
        else if (operation === "tracks/:trackId") respond(res, await source.getTrack(String(req.params.trackId), scope), providerTrackSchema);
        else respond(res, await source.resolvePlayback(String(req.params.trackId), scope), localPlaybackSchema);
      } catch { res.status(403).json(failure("ACCESS_DENIED")); }
    });
  }
}

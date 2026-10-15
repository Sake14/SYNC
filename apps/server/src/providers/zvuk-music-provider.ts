import { z } from "zod";
import {
  providerSearchSchema, providerTrackSchema, providerPlaylistSchema, zvukTrackIdSchema, zvukTrackPage,
  type MusicProvider, type MusicProviderContext, type MusicProviderInfo, type MusicOperation,
  type ProviderTrack, type ProviderResult, type ProviderPlaylist, type LocalPlayback, type ProviderSearchInput,
} from "@sync/shared";
import { failure } from "./results.js";

type MetadataOperation = Exclude<MusicOperation, "resolvePlayback">;
/** This is an internal normalized adapter contract, NOT a claimed official Zvuk wire API. */
export interface ApprovedZvukMetadataAdapter {
  request(operation: MetadataOperation, input: { query?: string; limit?: number; trackId?: string; accountKey?: string }, signal: AbortSignal): Promise<{
    statusCode: number; body: unknown; authFailure?: "expired"; retryAfterSeconds?: number;
  }>;
}
const approvalSchema = z.strictObject({
  documentationUrl: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["zvuk.com", "developers.sber.ru"].includes(url.hostname);
  }),
  permissionReference: z.string().trim().min(1).max(200),
  validUntil: z.number().int().positive(),
  operations: z.array(z.enum(["searchTracks", "getTrack", "getUserLibrary", "getPlaylists"])).min(1).max(4),
  publicMetadata: z.boolean(),
});
export type ZvukMetadataApproval = z.infer<typeof approvalSchema>;
export type ZvukProviderOptions = {
  integration?: { approval: ZvukMetadataApproval; adapter: ApprovedZvukMetadataAdapter };
  now?: () => number;
  timeoutMs?: number;
};
const trackMetadataSchema = z.strictObject({
  id: zvukTrackIdSchema, title: z.string().trim().min(1).max(200), artist: z.string().trim().min(1).max(200),
  durationSeconds: z.number().finite().positive().nullable(),
});
const tracksSchema = z.strictObject({ tracks: z.array(trackMetadataSchema).max(100) });
const playlistsSchema = z.strictObject({ playlists: z.array(z.strictObject({
  id: zvukTrackIdSchema, title: z.string().trim().min(1).max(200), trackIds: z.array(zvukTrackIdSchema).max(1000),
})).max(100) });
const gatewayResponseSchema = z.strictObject({
  statusCode: z.number().int().min(100).max(599), body: z.unknown(),
  authFailure: z.literal("expired").optional(), retryAfterSeconds: z.number().finite().optional(),
});
function metadata(track: z.infer<typeof trackMetadataSchema>): ProviderTrack {
  return providerTrackSchema.parse({ ...track, provider: "zvuk", officialUrl: zvukTrackPage(track.id) });
}

/** Closed by default. No web-session extraction, private endpoints, stream URLs or music tokens. */
export class ZvukMusicProvider implements MusicProvider {
  private readonly approval?: ZvukMetadataApproval;
  private readonly adapter?: ApprovedZvukMetadataAdapter;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  constructor(options: ZvukProviderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) throw new Error("Invalid provider timeout");
    if (options.integration) {
      const parsed = approvalSchema.safeParse(options.integration.approval);
      // Invalid configuration disables only this optional provider, not Local Music startup.
      if (parsed.success) { this.approval = parsed.data; this.adapter = options.integration.adapter; }
    }
  }
  get info(): MusicProviderInfo {
    const available = !!this.approval && !!this.adapter && this.approval.validUntil > this.now();
    const supported = (operation: MetadataOperation) => available && this.approval!.operations.includes(operation);
    return { id: "zvuk", name: "Звук", mode: available ? "approved-metadata" : "unconfigured",
      capabilities: { searchTracks: supported("searchTracks"), getTrack: supported("getTrack"), getUserLibrary: supported("getUserLibrary"), getPlaylists: supported("getPlaylists"), resolvePlayback: false } };
  }
  private async invoke<T>(operation: MetadataOperation, input: { query?: string; limit?: number; trackId?: string }, context: MusicProviderContext | undefined, parse: (body: unknown) => T): Promise<ProviderResult<T>> {
    if (!this.approval || !this.adapter || !this.approval.operations.includes(operation)) return failure("UNSUPPORTED");
    if (this.approval.validUntil <= this.now()) return failure("ACCESS_DENIED");
    const account = context?.zvukAccountKey;
    if (account !== undefined && !z.string().min(1).max(128).safeParse(account).success) return failure("INVALID_INPUT");
    if ((!this.approval.publicMetadata || operation === "getUserLibrary" || operation === "getPlaylists") && !account) return failure("ACCESS_DENIED");
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        this.adapter.request(operation, { ...input, ...(account ? { accountKey: account } : {}) }, abort.signal),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { abort.abort(); reject(new Error("Provider timeout")); }, this.timeoutMs); }),
      ]);
      const parsed = gatewayResponseSchema.safeParse(raw);
      if (!parsed.success) return failure("INVALID_RESPONSE");
      const response = parsed.data;
      if (this.approval.validUntil <= this.now()) return failure("ACCESS_DENIED");
      if (response.statusCode === 401) return failure(response.authFailure === "expired" ? "TOKEN_EXPIRED" : "ACCESS_DENIED");
      if (response.statusCode === 403) return failure("ACCESS_DENIED");
      if (response.statusCode === 404) return failure("NOT_FOUND");
      if (response.statusCode === 429) {
        const seconds = z.number().int().min(0).max(86400).safeParse(response.retryAfterSeconds);
        return failure("RATE_LIMITED", seconds.success ? { retryAfterSeconds: seconds.data } : {});
      }
      if (response.statusCode >= 500) return failure("SERVICE_UNAVAILABLE");
      if (response.statusCode !== 200) return failure("INVALID_RESPONSE");
      try { return { status: "OK", data: parse(response.body) }; } catch { return failure("INVALID_RESPONSE"); }
    } catch {
      // Never expose response bodies, URLs, tokens or upstream exception messages.
      return failure(abort.signal.aborted ? "SERVICE_UNAVAILABLE" : "NETWORK_ERROR");
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  }
  async searchTracks(input: ProviderSearchInput, context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack[]>> {
    const parsed = providerSearchSchema.safeParse(input);
    if (!parsed.success || !parsed.data.query) return failure("INVALID_INPUT");
    return this.invoke("searchTracks", parsed.data, context, body => tracksSchema.parse(body).tracks.slice(0, parsed.data.limit).map(metadata));
  }
  async getTrack(trackId: string, context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack>> {
    if (!zvukTrackIdSchema.safeParse(trackId).success) return failure("INVALID_INPUT");
    return this.invoke("getTrack", { trackId }, context, body => {
      const track = z.strictObject({ track: trackMetadataSchema }).parse(body).track;
      if (track.id !== trackId) throw new Error("Mismatched track");
      return metadata(track);
    });
  }
  async getUserLibrary(context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack[]>> {
    return this.invoke("getUserLibrary", {}, context, body => tracksSchema.parse(body).tracks.map(metadata));
  }
  async getPlaylists(context?: MusicProviderContext): Promise<ProviderResult<ProviderPlaylist[]>> {
    return this.invoke("getPlaylists", {}, context, body => playlistsSchema.parse(body).playlists.map(item => providerPlaylistSchema.parse({ ...item, provider: "zvuk" })));
  }
  async resolvePlayback(trackId: string): Promise<ProviderResult<LocalPlayback>> {
    if (!zvukTrackIdSchema.safeParse(trackId).success) return failure("INVALID_INPUT");
    // Metadata approval never grants playback, DRM handling, redistribution or proxying rights.
    return failure("UNSUPPORTED", { officialUrl: zvukTrackPage(trackId) });
  }
}

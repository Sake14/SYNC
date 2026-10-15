import { z } from "zod";

export const musicProviderIdSchema = z.enum(["local", "zvuk"]);
export type MusicProviderId = z.infer<typeof musicProviderIdSchema>;
export const musicOperations = ["searchTracks", "getTrack", "getUserLibrary", "getPlaylists", "resolvePlayback"] as const;
export type MusicOperation = typeof musicOperations[number];
export const zvukTrackIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
export function zvukTrackPage(trackId: string): string {
  return `https://zvuk.com/track/${zvukTrackIdSchema.parse(trackId)}`;
}
export const zvukTrackReferenceSchema = z.string().trim().max(512).transform((value, context) => {
  if (zvukTrackIdSchema.safeParse(value).success) return value;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/track\/([1-9][0-9]{0,19})\/?$/);
    if (url.protocol === "https:" && url.hostname === "zvuk.com" && !url.port && !url.username && !url.password && match) return match[1]!;
  } catch { /* Report one safe validation message without echoing the input. */ }
  context.addIssue({ code: "custom", message: "Введите ID трека или ссылку https://zvuk.com/track/…" });
  return z.NEVER;
});

const metadata = {
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
  durationSeconds: z.number().finite().positive().nullable(),
};
export const providerTrackSchema = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("local"), id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), ...metadata }),
  z.strictObject({ provider: z.literal("zvuk"), id: zvukTrackIdSchema, ...metadata, officialUrl: z.url() })
    .refine(track => track.officialUrl === zvukTrackPage(track.id), "Use the canonical official track page"),
]);
export type ProviderTrack = z.infer<typeof providerTrackSchema>;
export const providerPlaylistSchema = z.strictObject({
  provider: musicProviderIdSchema,
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string().trim().min(1).max(200),
  trackIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(1000),
});
export type ProviderPlaylist = z.infer<typeof providerPlaylistSchema>;
export const providerSearchSchema = z.strictObject({ query: z.string().trim().max(200), limit: z.number().int().min(1).max(50).default(20) });
export type ProviderSearchInput = z.input<typeof providerSearchSchema>;
export const localPlaybackSchema = z.strictObject({
  kind: z.literal("local-http"), provider: z.literal("local"),
  streamPath: z.string().regex(/^\/media\/[A-Za-z0-9_-]{1,128}\.(mp3|wav|ogg|m4a)$/),
  durationSeconds: z.number().finite().positive(),
});
export type LocalPlayback = z.infer<typeof localPlaybackSchema>;
export const providerFailureStatusSchema = z.enum([
  "UNSUPPORTED", "ACCESS_DENIED", "TOKEN_EXPIRED", "SERVICE_UNAVAILABLE", "NETWORK_ERROR",
  "RATE_LIMITED", "NOT_FOUND", "INVALID_INPUT", "INVALID_RESPONSE",
]);
export type ProviderFailureStatus = z.infer<typeof providerFailureStatusSchema>;
export const providerFailureSchema = z.strictObject({
  status: providerFailureStatusSchema, message: z.string().min(1).max(300),
  officialUrl: z.string().regex(/^https:\/\/zvuk\.com\/track\/[1-9][0-9]{0,19}$/).optional(),
  retryAfterSeconds: z.number().int().min(0).max(86400).optional(),
});
export type ProviderFailure = z.infer<typeof providerFailureSchema>;
export type ProviderResult<T> = { status: "OK"; data: T } | ProviderFailure;
export function providerResultSchema<T extends z.ZodType>(data: T) {
  return z.union([z.strictObject({ status: z.literal("OK"), data }), providerFailureSchema]);
}
export const providerInfoSchema = z.strictObject({
  id: musicProviderIdSchema, name: z.string().min(1).max(64),
  mode: z.enum(["local", "unconfigured", "approved-metadata"]),
  capabilities: z.strictObject({ searchTracks: z.boolean(), getTrack: z.boolean(), getUserLibrary: z.boolean(), getPlaylists: z.boolean(), resolvePlayback: z.boolean() }),
});
export type MusicProviderInfo = z.infer<typeof providerInfoSchema>;
export const musicProvidersSchema = z.strictObject({ providers: z.array(providerInfoSchema).max(2) });

/** Server-only references. Neither Socket.IO credentials nor music tokens are public provider data. */
export type MusicProviderContext = {
  localRoom?: { roomId: string; connectionId: string };
  zvukAccountKey?: string;
};
export interface MusicProvider {
  readonly info: MusicProviderInfo;
  searchTracks(input: ProviderSearchInput, context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack[]>>;
  getTrack(trackId: string, context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack>>;
  getUserLibrary(context?: MusicProviderContext): Promise<ProviderResult<ProviderTrack[]>>;
  getPlaylists(context?: MusicProviderContext): Promise<ProviderResult<ProviderPlaylist[]>>;
  resolvePlayback(trackId: string, context?: MusicProviderContext): Promise<ProviderResult<LocalPlayback>>;
}

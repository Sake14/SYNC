import { z } from "zod";
import { trackSchema } from "./tracks.js";
export * from "./tracks.js";
export * from "./rooms.js";
export * from "./sync-engine.js";
export * from "./music-provider.js";

export const PROTOCOL_VERSION = 4 as const;
export const displayNameSchema = z.string().trim().min(1, "Введите имя").max(32, "Не больше 32 символов");
export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,32}$/);
const timestampSchema = z.number().int().nonnegative();

export const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("listen-together-server"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  timestamp: timestampSchema,
  uptimeSeconds: z.number().nonnegative(),
});
export type Health = z.infer<typeof healthSchema>;

export const catalogSchema = z.object({ tracks: z.array(trackSchema) });
export const uploadLimitsSchema = z.strictObject({ maxFileBytes: z.number().int().positive(), maxRoomBytes: z.number().int().positive(), maxRoomFiles: z.number().int().positive() });
export const uploadResponseSchema = z.strictObject({ track: trackSchema });
export const roomLibrarySchema = z.strictObject({tracks:z.array(trackSchema),limits:uploadLimitsSchema});
export const httpErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const clockPingSchema = z.strictObject({ clientSentAtMs: timestampSchema });
export const clockPongSchema = z.object({ clientSentAtMs: timestampSchema, serverReceivedAtMs: timestampSchema, serverSentAtMs: timestampSchema });
export const readySchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), serverTimeMs: timestampSchema });
export type ClockPing = z.infer<typeof clockPingSchema>;
export type ClockPong = z.infer<typeof clockPongSchema>;
export type ServerReady = z.infer<typeof readySchema>;

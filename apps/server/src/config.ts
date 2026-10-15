import { z } from "zod";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const originSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && url.origin === value;
}, "Use an HTTP(S) origin without a trailing slash or path");

const configSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MEDIA_DIR: z.string().min(1).optional(),
  UPLOAD_DIR: z.string().min(1).optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(20 * 1024 * 1024),
  MAX_ROOM_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(500 * 1024 * 1024).default(100 * 1024 * 1024),
  MAX_STORAGE_BYTES: z.coerce.number().int().min(1024).max(5 * 1024 * 1024 * 1024).default(512 * 1024 * 1024),
  CLIENT_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000")
    .transform((value) => value.split(",").map((origin) => origin.trim()))
    .pipe(z.array(originSchema).min(1)),
  MAX_ROOM_PARTICIPANTS: z.coerce.number().int().min(1).max(100).default(20),
  MAX_ROOMS: z.coerce.number().int().min(1).max(10_000).default(100),
  PLAY_LEAD_MS: z.coerce.number().int().min(100).max(3000).default(750),
  RECONNECT_GRACE_MS: z.coerce.number().int().min(1).max(300_000).default(30_000),
  EMPTY_ROOM_TTL_MS: z.coerce.number().int().min(1).max(3_600_000).default(300_000),
}).refine((config) => config.EMPTY_ROOM_TTL_MS >= config.RECONNECT_GRACE_MS, {
  path: ["EMPTY_ROOM_TTL_MS"], message: "Room retention must cover reconnect grace",
}).refine(config => config.MAX_ROOM_UPLOAD_BYTES >= config.MAX_UPLOAD_BYTES && config.MAX_STORAGE_BYTES >= config.MAX_ROOM_UPLOAD_BYTES, {message:"Upload quotas must contain the file limit"});

export function parseConfig(env: NodeJS.ProcessEnv) {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    // Report only field names; never dump environment values.
    throw new Error(`Invalid server configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return {
    host: parsed.data.HOST, port: parsed.data.PORT, clientOrigins: parsed.data.CLIENT_ORIGINS,
    mediaDir: resolve(parsed.data.MEDIA_DIR ?? fileURLToPath(new URL("../../../media", import.meta.url))),
    uploads: { directory: resolve(parsed.data.UPLOAD_DIR ?? fileURLToPath(new URL("../../../.data/uploads", import.meta.url))), maxFileBytes: parsed.data.MAX_UPLOAD_BYTES, maxRoomBytes: parsed.data.MAX_ROOM_UPLOAD_BYTES, maxStorageBytes: parsed.data.MAX_STORAGE_BYTES, maxRoomFiles: 20 },
    rooms: {
      maxParticipants: parsed.data.MAX_ROOM_PARTICIPANTS,
      maxRooms: parsed.data.MAX_ROOMS,
      playLeadMs: parsed.data.PLAY_LEAD_MS,
      reconnectGraceMs: parsed.data.RECONNECT_GRACE_MS,
      emptyRoomTtlMs: parsed.data.EMPTY_ROOM_TTL_MS,
    },
  };
}
export type ServerConfig = ReturnType<typeof parseConfig>;

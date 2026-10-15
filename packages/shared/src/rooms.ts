import { z } from "zod";
import { trackSchema } from "./tracks.js";
import type { ClockPing, ClockPong, ServerReady } from "./index.js";

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const roomId = z.string().regex(/^[A-Za-z0-9_-]{10,32}$/);
const participantId = z.string().regex(/^[A-Za-z0-9_-]{16}$/);
const displayName = z.string().trim().min(1).max(32);
const resumeToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
export const roomAccessSchema = z.strictObject({ roomId, resumeToken });
export const queueEntrySchema = z.strictObject({ id: participantId, trackId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), addedBy: participantId, addedByName: displayName, addedAt: timestamp });
export type QueueEntry = z.infer<typeof queueEntrySchema>;
export const reactionEmojiSchema = z.enum(["❤️", "🔥", "😭", "🎧"]);
export const reactionSchema = z.strictObject({ id: participantId, roomId, participantId, displayName, emoji: reactionEmojiSchema, serverTime: timestamp });
export type Reaction = z.infer<typeof reactionSchema>;
export const trackIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const positionSchema = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER / 1000);
export const playbackStatusSchema = z.enum(["paused", "playing"]);

const timelineFields = {
  trackId: trackIdSchema.nullable(),
  trackRevision: revision,
  playbackState: playbackStatusSchema,
  // Seconds at the startedAt anchor. While paused, this is the fixed position.
  position: positionSchema,
  startedAt: timestamp.nullable(),
  revision,
};
function validTimeline(state: { playbackState: string; trackId: string | null; startedAt: number | null }) {
  return state.playbackState === "playing"
    ? state.trackId !== null && state.startedAt !== null
    : state.startedAt === null;
}
export const readinessStatusSchema = z.enum(["loading", "blocked", "buffering", "clock", "ready", "error", "stale"]);
export const readinessSchema = z.strictObject({
  trackRevision: revision, status: readinessStatusSchema,
  bufferedSeconds: z.number().finite().nonnegative().max(86400),
  soundUnlocked: z.boolean(), clockSynced: z.boolean(),
}).refine((value) => value.status !== "ready" || (value.soundUnlocked && value.clockSynced && value.bufferedSeconds > 0), "Ready requires buffer, audio permission and calibrated clocks");
export type Readiness = z.infer<typeof readinessSchema>;
export const participantSchema = z.strictObject({ id: participantId, displayName, joinedAt: timestamp, readiness: readinessSchema });
export type Participant = z.infer<typeof participantSchema>;
export const roomSchema = z.strictObject({
  id: roomId,
  name: z.string().trim().min(1).max(64),
  hostId: participantId.nullable(),
  participants: z.array(participantSchema).max(100),
  library: z.array(trackSchema).max(20).default([]),
  queue: z.array(queueEntrySchema).max(50).default([]),
  ...timelineFields,
  createdAt: timestamp,
}).refine(validTimeline, { message: "Invalid playback timeline" }).refine((room) => {
  const ids = new Set(room.participants.map((participant) => participant.id));
  return ids.size === room.participants.length && (room.participants.length === 0
    ? room.hostId === null && room.playbackState === "paused"
    : room.hostId !== null && ids.has(room.hostId));
}, { message: "Host must be an active participant; participant IDs must be unique" });
export type Room = z.infer<typeof roomSchema>;

export const roomSnapshotSchema = z.strictObject({ room: roomSchema, serverTime: timestamp });
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export const playbackStateSchema = z.strictObject({ roomId, ...timelineFields, serverTime: timestamp })
  .refine(validTimeline, { message: "Invalid playback timeline" });
export type PlaybackState = z.infer<typeof playbackStateSchema>;

export const roomCreateSchema = z.strictObject({ displayName, name: z.string().trim().min(1).max(64).optional() });
export const roomJoinSchema = z.union([
  z.strictObject({ roomId, displayName }),
  z.strictObject({ roomId, resumeToken }),
]);
export const roomRequestSchema = z.strictObject({ roomId });
export const revisionCommandSchema = z.strictObject({ roomId, expectedRevision: revision });
export const roomLeaveSchema = revisionCommandSchema;
export const participantCommandSchema = revisionCommandSchema.extend({ participantId });
export type ParticipantCommand = z.infer<typeof participantCommandSchema>;
export const roomRemovedSchema = z.strictObject({ roomId, reason: z.literal("kicked"), revision, serverTime: timestamp });
export type RoomRemoved = z.infer<typeof roomRemovedSchema>;
export const playerPlaySchema = revisionCommandSchema;
export const playerPauseSchema = revisionCommandSchema;
export const playerSeekSchema = revisionCommandSchema.extend({ position: positionSchema });
export const trackChangeSchema = revisionCommandSchema.extend({ trackId: trackIdSchema.nullable() });
export const queueAddSchema = revisionCommandSchema.extend({ trackId: trackIdSchema });
export const queueRemoveSchema = revisionCommandSchema.extend({ entryId: participantId });
export const queueMoveSchema = queueRemoveSchema.extend({ direction: z.enum(["up", "down"]) });
export const reactionSendSchema = z.strictObject({ roomId, emoji: reactionEmojiSchema });
export const syncPingSchema = z.strictObject({ roomId, clientSentAtMs: timestamp });
export const syncPongSchema = z.strictObject({
  roomId,
  clientSentAtMs: timestamp,
  serverReceivedAtMs: timestamp,
  serverSentAtMs: timestamp,
  revision,
});
export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomJoinInput = z.infer<typeof roomJoinSchema>;
export type RoomRequest = z.infer<typeof roomRequestSchema>;
export type RevisionCommand = z.infer<typeof revisionCommandSchema>;
export type RoomLeaveInput = z.infer<typeof roomLeaveSchema>;
export type PlayerPlayInput = z.infer<typeof playerPlaySchema>;
export type PlayerPauseInput = z.infer<typeof playerPauseSchema>;
export type PlayerSeekInput = z.infer<typeof playerSeekSchema>;
export type TrackChangeInput = z.infer<typeof trackChangeSchema>;
export type SyncPing = z.infer<typeof syncPingSchema>;
export type SyncPong = z.infer<typeof syncPongSchema>;
export const playerReadySchema = z.strictObject({
  roomId, trackId: trackIdSchema, sequence: revision,
  trackRevision: revision, status: readinessStatusSchema,
  bufferedSeconds: z.number().finite().nonnegative().max(86400),
  soundUnlocked: z.boolean(), clockSynced: z.boolean(),
}).refine((value) => value.status !== "ready" || (value.soundUnlocked && value.clockSynced && value.bufferedSeconds > 0));
export type PlayerReadyInput = z.infer<typeof playerReadySchema>;

export const membershipSchema = z.strictObject({
  snapshot: roomSnapshotSchema,
  participantId,
  resumeToken,
  resumed: z.boolean(),
});
export type Membership = z.infer<typeof membershipSchema>;
export const participantJoinedSchema = z.strictObject({
  roomId,
  participant: participantSchema,
  hostId: participantId,
  revision,
  serverTime: timestamp,
});
export const participantLeftSchema = z.strictObject({
  roomId,
  participantId,
  hostId: participantId.nullable(),
  reason: z.enum(["leave", "disconnect", "kick"]),
  revision,
  serverTime: timestamp,
});
export type ParticipantJoined = z.infer<typeof participantJoinedSchema>;
export type ParticipantLeft = z.infer<typeof participantLeftSchema>;

export const errorCodeSchema = z.enum([
  "INVALID_PAYLOAD", "ROOM_NOT_FOUND", "NOT_MEMBER", "NOT_HOST", "ROOM_FULL",
  "ROOM_LIMIT", "SESSION_LIMIT", "INVALID_SESSION", "ALREADY_IN_ROOM", "PARTICIPANT_NOT_FOUND", "CANNOT_REMOVE_HOST",
  "STALE_REVISION", "NO_TRACK", "TRACK_NOT_FOUND", "NOT_READY", "QUEUE_FULL", "QUEUE_EMPTY", "NOT_QUEUE_OWNER", "RATE_LIMIT", "LIBRARY_FULL", "ID_EXHAUSTED", "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type CommandError = { code: ErrorCode; message: string; currentRevision?: number };
export type Ack<T> = { ok: true; data: T } | { ok: false; error: CommandError };
export type Acknowledge<T> = (result: Ack<T>) => void;

export interface ClientToServerEvents {
  "room:create": (payload: RoomCreateInput, ack: Acknowledge<Membership>) => void;
  "room:join": (payload: RoomJoinInput, ack: Acknowledge<Membership>) => void;
  "room:leave": (payload: RoomLeaveInput, ack: Acknowledge<RoomSnapshot>) => void;
  "room:snapshot": (payload: RoomRequest, ack: Acknowledge<RoomSnapshot>) => void;
  "room:kick": (payload: ParticipantCommand, ack: Acknowledge<RoomSnapshot>) => void;
  "room:transfer-host": (payload: ParticipantCommand, ack: Acknowledge<RoomSnapshot>) => void;
  "player:play": (payload: PlayerPlayInput, ack: Acknowledge<PlaybackState>) => void;
  "player:pause": (payload: PlayerPauseInput, ack: Acknowledge<PlaybackState>) => void;
  "player:seek": (payload: PlayerSeekInput, ack: Acknowledge<PlaybackState>) => void;
  "player:ready": (payload: PlayerReadyInput, ack: Acknowledge<RoomSnapshot>) => void;
  "queue:add": (payload: z.infer<typeof queueAddSchema>, ack: Acknowledge<RoomSnapshot>) => void;
  "queue:remove": (payload: z.infer<typeof queueRemoveSchema>, ack: Acknowledge<RoomSnapshot>) => void;
  "queue:move": (payload: z.infer<typeof queueMoveSchema>, ack: Acknowledge<RoomSnapshot>) => void;
  "queue:next": (payload: RevisionCommand, ack: Acknowledge<RoomSnapshot>) => void;
  "reaction:send": (payload: z.infer<typeof reactionSendSchema>, ack: Acknowledge<Reaction>) => void;
  "track:change": (payload: TrackChangeInput, ack: Acknowledge<PlaybackState>) => void;
  "sync:ping": (payload: SyncPing, ack: Acknowledge<SyncPong>) => void;
  // Compatibility with the existing stage-1 health UI; no room access is granted.
  "clock:ping": (payload: ClockPing, ack: Acknowledge<ClockPong>) => void;
}
export interface ServerToClientEvents {
  "server:ready": (payload: ServerReady) => void;
  "room:snapshot": (payload: RoomSnapshot) => void;
  "room:removed": (payload: RoomRemoved) => void;
  "participant:joined": (payload: ParticipantJoined) => void;
  "participant:left": (payload: ParticipantLeft) => void;
  "player:state": (payload: PlaybackState) => void;
  "track:change": (payload: PlaybackState) => void;
  "sync:pong": (payload: SyncPong) => void;
  "reaction:received": (payload: Reaction) => void;
}

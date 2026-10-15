import { nanoid } from "nanoid";
import type {
  Membership, Participant, ParticipantLeft, PlaybackState, PlayerSeekInput,
  RevisionCommand, Room, RoomCreateInput, RoomJoinInput, RoomRequest, RoomSnapshot, TrackChangeInput, Readiness, PlayerReadyInput, Track, Reaction, QueueEntry, ParticipantCommand,
} from "@sync/shared";
import { SyncEngine } from "../sync/sync-engine.js";
import { RoomError } from "./room-error.js";

type Session = {
  participant: Participant;
  connectionId: string | null;
  expiresAt: number | null;
  readySequence: number;
  readyAt: number | null;
  lastReactionAt?: number;
};
type RoomRecord = {
  room: Room;
  sessions: Map<string, Session>;
  emptySince: number | null;
};
type Connection = { roomId: string; token: string };
export type JoinResult = {
  membership: Membership;
  participantJoined: boolean;
  replacedConnectionId?: string;
};
export type LeaveResult = { snapshot: RoomSnapshot; event: ParticipantLeft };
export type RoomManagerOptions = {
  maxParticipants?: number;
  maxRooms?: number;
  reconnectGraceMs?: number;
  emptyRoomTtlMs?: number;
  now?: () => number;
  generateId?: (size: number) => string;
  getTrackDuration?: (trackId: string) => number | undefined;
  playLeadMs?: number;
};

/** Owns all state and authorization. Knows only opaque connection IDs, never sockets. */
export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly connections = new Map<string, Connection>();
  private readonly sync = new SyncEngine();
  private readonly maxParticipants: number;
  private readonly maxRooms: number;
  private readonly reconnectGraceMs: number;
  private readonly emptyRoomTtlMs: number;
  private readonly clock: () => number;
  private readonly generateId: (size: number) => string;
  private lastTime = 0;
  private readonly getTrackDuration?: RoomManagerOptions["getTrackDuration"];
  private readonly playLeadMs: number;

  constructor(options: RoomManagerOptions = {}) {
    this.maxParticipants = options.maxParticipants ?? 20;
    this.maxRooms = options.maxRooms ?? 100;
    this.reconnectGraceMs = options.reconnectGraceMs ?? 30_000;
    this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? 300_000;
    if (!Number.isInteger(this.maxParticipants) || this.maxParticipants < 1 || this.maxParticipants > 100
      || !Number.isInteger(this.maxRooms) || this.maxRooms < 1 || this.maxRooms > 10_000
      || !Number.isSafeInteger(this.reconnectGraceMs) || this.reconnectGraceMs < 1 || this.reconnectGraceMs > 300_000
      || !Number.isSafeInteger(this.emptyRoomTtlMs) || this.emptyRoomTtlMs < this.reconnectGraceMs || this.emptyRoomTtlMs > 3_600_000) {
      throw new Error("Invalid RoomManager limits");
    }
    this.clock = options.now ?? Date.now;
    this.generateId = options.generateId ?? nanoid;
    this.getTrackDuration = options.getTrackDuration;
    this.playLeadMs = options.playLeadMs ?? 750;
    if (!Number.isInteger(this.playLeadMs) || this.playLeadMs < 100 || this.playLeadMs > 3000) throw new Error("Invalid playback lead");
  }

  get size() { return this.rooms.size; }
  serverNow() { return this.now(); }

  create(connectionId: string, input: RoomCreateInput): JoinResult {
    const now = this.now();
    this.sweep(now);
    this.assertVacant(connectionId);
    if (this.rooms.size >= this.maxRooms) throw new RoomError("ROOM_LIMIT", "Room limit reached");
    const id = this.uniqueId(12, (candidate) => this.rooms.has(candidate));
    const participant: Participant = { id: this.generateId(16), displayName: input.displayName, joinedAt: now, readiness: this.unready(0) };
    const token = this.generateId(32);
    const record: RoomRecord = {
      room: {
        id, name: input.name ?? `Комната ${id.slice(0, 6)}`, hostId: participant.id, participants: [participant], trackId: null,
        playbackState: "paused", position: 0, startedAt: null, revision: 1, trackRevision: 0, createdAt: now, library: [], queue: [],
      },
      sessions: new Map([[token, { participant, connectionId, expiresAt: null, readySequence: -1, readyAt: null }]]),
      emptySince: null,
    };
    this.rooms.set(id, record);
    this.connections.set(connectionId, { roomId: id, token });
    return this.joinResult(record, token, false, true, now);
  }

  join(connectionId: string, input: RoomJoinInput): JoinResult {
    const now = this.now();
    this.sweep(now);
    const record = this.requireRoom(input.roomId);
    const current = this.connections.get(connectionId);
    if (current) {
      if (current.roomId === input.roomId && (!("resumeToken" in input) || current.token === input.resumeToken)) {
        // Retried join on the same connection must not duplicate membership or revision.
        return this.joinResult(record, current.token, "resumeToken" in input, false, now);
      }
      throw new RoomError("ALREADY_IN_ROOM", "Leave the current room before joining another");
    }

    if ("resumeToken" in input) {
      const session = record.sessions.get(input.resumeToken);
      if (!session) throw new RoomError("INVALID_SESSION", "Resume session is invalid or expired");
      const replacedConnectionId = session.connectionId ?? undefined;
      const participantJoined = session.connectionId === null;
      if (participantJoined) this.assertCapacity(record);
      if (replacedConnectionId) this.connections.delete(replacedConnectionId);
      session.connectionId = connectionId;
      session.expiresAt = null;
      session.readyAt = null;
      session.readySequence = -1;
      session.participant.readiness = this.unready(record.room.trackRevision);
      if (participantJoined) record.room.participants.push(session.participant);
      this.attach(record, connectionId, input.resumeToken, session.participant.id);
      return {
        ...this.joinResult(record, input.resumeToken, true, participantJoined, now),
        ...(replacedConnectionId ? { replacedConnectionId } : {}),
      };
    }

    this.assertCapacity(record);
    // Bound retained offline credentials as well as the number of active listeners.
    if (record.sessions.size >= this.maxParticipants * 4) {
      throw new RoomError("SESSION_LIMIT", "Reconnect session limit reached; retry after the grace period");
    }
    const token = this.uniqueId(32, (candidate) => record.sessions.has(candidate));
    const ids = new Set([...record.sessions.values()].map((session) => session.participant.id));
    const participant: Participant = {
      id: this.uniqueId(16, (candidate) => ids.has(candidate)), displayName: input.displayName, joinedAt: now, readiness: this.unready(record.room.trackRevision),
    };
    record.sessions.set(token, { participant, connectionId, expiresAt: null, readySequence: -1, readyAt: null });
    record.room.participants.push(participant);
    this.attach(record, connectionId, token, participant.id);
    return this.joinResult(record, token, false, true, now);
  }

  getSnapshot(connectionId: string, input: RoomRequest): RoomSnapshot {
    const now = this.now();
    const { record } = this.member(connectionId, input.roomId);
    return this.snapshot(record, now);
  }

  getParticipants(connectionId: string, input: RoomRequest): Participant[] {
    return this.getSnapshot(connectionId, input).room.participants;
  }

  hasRoom(roomId: string) { return this.rooms.has(roomId); }
  getBroadcastSnapshot(roomId: string) { return this.snapshot(this.requireRoom(roomId), this.now()); }
  authorizeToken(roomId: string, token: string): string {
    const record = this.requireRoom(roomId);
    const session = record.sessions.get(token);
    if (!session || session.connectionId === null || !this.connections.has(session.connectionId)) throw new RoomError("INVALID_SESSION", "Active room membership required");
    return session.connectionId;
  }
  addLibraryTrack(connectionId: string, roomId: string, track: Track): RoomSnapshot {
    const { record } = this.member(connectionId, roomId);
    if (record.room.library.length >= 20) throw new RoomError("LIBRARY_FULL", "Room library is full");
    if (record.room.library.some(t => t.id === track.id)) throw new RoomError("INVALID_PAYLOAD", "Duplicate track");
    record.room.library.push(structuredClone(track)); record.room.revision++;
    return this.snapshot(record, this.now());
  }
  addToQueue(connectionId: string, input: RevisionCommand & {trackId:string}): RoomSnapshot {
    const { record, session } = this.member(connectionId, input.roomId);
    this.assertRevision(record.room, input.expectedRevision); this.assertAvailable(record.room, input.trackId);
    if (record.room.queue.length >= 50) throw new RoomError("QUEUE_FULL", "Queue is full");
    const entry: QueueEntry = { id: this.uniqueId(16, id => record.room.queue.some(e => e.id === id)), trackId: input.trackId,
      addedBy: session.participant.id, addedByName: session.participant.displayName, addedAt: this.now() };
    record.room.queue.push(entry); record.room.revision++;
    return this.snapshot(record, this.now());
  }
  removeFromQueue(connectionId: string, input: RevisionCommand & {entryId:string}): RoomSnapshot {
    const { record, session } = this.member(connectionId, input.roomId); this.assertRevision(record.room, input.expectedRevision);
    const entry = record.room.queue.find(e => e.id === input.entryId);
    if (!entry) throw new RoomError("INVALID_PAYLOAD", "Queue entry not found");
    if (entry.addedBy !== session.participant.id && record.room.hostId !== session.participant.id) throw new RoomError("NOT_QUEUE_OWNER", "Only the author or HOST may remove this entry");
    record.room.queue = record.room.queue.filter(e => e.id !== input.entryId); record.room.revision++;
    return this.snapshot(record, this.now());
  }
  moveQueueEntry(connectionId: string, input: RevisionCommand & {entryId:string;direction:"up"|"down"}): RoomSnapshot {
    const { record, session } = this.member(connectionId, input.roomId);
    if (record.room.hostId !== session.participant.id) throw new RoomError("NOT_HOST", "Only HOST reorders the queue");
    this.assertRevision(record.room, input.expectedRevision);
    const index = record.room.queue.findIndex(e => e.id === input.entryId);
    if (index < 0) throw new RoomError("INVALID_PAYLOAD", "Queue entry not found");
    const next = index + (input.direction === "up" ? -1 : 1);
    if (next >= 0 && next < record.room.queue.length) { [record.room.queue[index],record.room.queue[next]] = [record.room.queue[next]!,record.room.queue[index]!]; record.room.revision++; }
    return this.snapshot(record, this.now());
  }
  nextInQueue(connectionId: string, input: RevisionCommand): RoomSnapshot {
    const { record, session } = this.member(connectionId, input.roomId);
    if(record.room.hostId!==session.participant.id)throw new RoomError("NOT_HOST","Only HOST changes the current track");
    this.assertRevision(record.room,input.expectedRevision);
    const entry = record.room.queue[0];
    if (!entry) throw new RoomError("QUEUE_EMPTY", "Queue is empty");
    this.changeTrack(connectionId, {...input,trackId:entry.trackId});
    record.room.queue.shift(); return this.snapshot(record,this.now());
  }
  react(connectionId: string, input: {roomId:string;emoji:Reaction["emoji"]}): Reaction {
    const {session} = this.member(connectionId,input.roomId); const now=this.now();
    if (session.lastReactionAt !== undefined && now-session.lastReactionAt < 500) throw new RoomError("RATE_LIMIT", "Wait before sending another reaction");
    session.lastReactionAt=now;
    return {id:this.generateId(16),roomId:input.roomId,participantId:session.participant.id,displayName:session.participant.displayName,emoji:input.emoji,serverTime:now};
  }

  leave(connectionId: string, input: RevisionCommand): LeaveResult {
    const { record } = this.member(connectionId, input.roomId);
    this.assertRevision(record.room, input.expectedRevision);
    return this.removeConnection(connectionId, "leave", this.now())!;
  }

  disconnect(connectionId: string): LeaveResult | null {
    return this.removeConnection(connectionId, "disconnect", this.now());
  }

  transferHost(connectionId: string, input: ParticipantCommand): RoomSnapshot {
    const { record, session } = this.member(connectionId, input.roomId);
    if (record.room.hostId !== session.participant.id) throw new RoomError("NOT_HOST", "Only HOST transfers the role");
    this.assertRevision(record.room, input.expectedRevision);
    const target = [...record.sessions.values()].find(value => value.participant.id === input.participantId && value.connectionId !== null);
    if (!target) throw new RoomError("PARTICIPANT_NOT_FOUND", "Participant is no longer connected");
    if (record.room.hostId !== target.participant.id) { record.room.hostId = target.participant.id; record.room.revision++; }
    return this.snapshot(record, this.now());
  }

  kick(connectionId: string, input: ParticipantCommand): LeaveResult & { connectionId: string } {
    const { record, session } = this.member(connectionId, input.roomId);
    if (record.room.hostId !== session.participant.id) throw new RoomError("NOT_HOST", "Only HOST removes participants");
    this.assertRevision(record.room, input.expectedRevision);
    if (input.participantId === record.room.hostId) throw new RoomError("CANNOT_REMOVE_HOST", "Transfer HOST or leave instead");
    const target = [...record.sessions.values()].find(value => value.participant.id === input.participantId && value.connectionId !== null);
    if (!target?.connectionId) throw new RoomError("PARTICIPANT_NOT_FOUND", "Participant is no longer connected");
    const targetConnection = target.connectionId;
    return { ...this.removeConnection(targetConnection, "kick", this.now())!, connectionId: targetConnection };
  }

  play(connectionId: string, input: RevisionCommand): PlaybackState {
    return this.mutate(connectionId, input, (room, now) => {
      this.assertTrack(room);
      const duration = room.trackId ? this.duration(room, room.trackId) : undefined;
      const record = this.requireRoom(room.id);
      if ([...record.sessions.values()].some((session) => session.connectionId !== null &&
        (session.participant.readiness.status !== "ready" || session.participant.readiness.trackRevision !== room.trackRevision ||
         session.readyAt === null || now - session.readyAt >= 15_000))) throw new RoomError("NOT_READY", "All active participants must confirm buffer, audio permission and clocks");
      Object.assign(room, this.sync.schedule(room, now, this.playLeadMs, duration));
    });
  }

  pause(connectionId: string, input: RevisionCommand): PlaybackState {
    return this.mutate(connectionId, input, (room, now) => {
      this.assertTrack(room);
      room.position = this.clamp(room, this.sync.positionAt(room, now));
      room.playbackState = "paused";
      room.startedAt = null;
    }, false);
  }

  reportReady(connectionId: string, input: PlayerReadyInput): RoomSnapshot {
    const { record, session } = this.member(connectionId, input.roomId);
    this.assertTrack(record.room);
    if (input.status === "ready" && (!input.soundUnlocked || !input.clockSynced || input.bufferedSeconds <= 0)) throw new RoomError("INVALID_PAYLOAD", "Ready requires buffer, audio permission and calibrated clocks");
    if (input.trackId !== record.room.trackId || input.trackRevision !== record.room.trackRevision || input.sequence <= session.readySequence) {
      throw new RoomError("STALE_REVISION", "Readiness belongs to an old track or report", record.room.revision);
    }
    const now = this.now();
    session.readySequence = input.sequence;
    session.readyAt = now;
    const { trackRevision, status, bufferedSeconds, soundUnlocked, clockSynced } = input;
    const before = session.participant.readiness;
    if (before.trackRevision !== trackRevision || before.status !== status || before.soundUnlocked !== soundUnlocked || before.clockSynced !== clockSynced) {
      session.participant.readiness = { trackRevision, status, bufferedSeconds, soundUnlocked, clockSynced };
      record.room.revision++;
    }
    return this.snapshot(record, now);
  }

  expireReadiness(): RoomSnapshot[] {
    const now = this.now();
    const snapshots: RoomSnapshot[] = [];
    for (const record of this.rooms.values()) {
      let changed = false;
      for (const session of record.sessions.values()) {
        if (session.connectionId !== null && session.participant.readiness.status === "ready" && session.readyAt !== null && now - session.readyAt >= 15_000) {
          session.participant.readiness = { ...this.unready(record.room.trackRevision), status: "stale" };
          changed = true;
        }
      }
      if (changed) { record.room.revision++; snapshots.push(this.snapshot(record, now)); }
    }
    return snapshots;
  }

  private unready(trackRevision: number): Readiness {
    return { trackRevision, status: "loading", bufferedSeconds: 0, soundUnlocked: false, clockSynced: false };
  }

  seek(connectionId: string, input: PlayerSeekInput): PlaybackState {
    return this.mutate(connectionId, input, (room, now) => {
      this.assertTrack(room);
      room.position = this.clamp(room, input.position);
      room.startedAt = room.playbackState === "playing" ? now : null;
    });
  }

  changeTrack(connectionId: string, input: TrackChangeInput): PlaybackState {
    return this.mutate(connectionId, input, (room) => {
      if (input.trackId !== null) this.assertAvailable(room, input.trackId);
      this.selectTrack(this.requireRoom(room.id), input.trackId);
    });
  }

  /** Catalog-aware completion is server-owned, even if every browser is muted. */
  finishTracks(): PlaybackState[] {
    const now = this.now();
    const states: PlaybackState[] = [];
    for (const record of this.rooms.values()) {
      const {room} = record;
      const duration = room.trackId ? this.duration(room, room.trackId) : undefined;
      if (room.playbackState !== "playing" || duration === undefined || this.sync.positionAt(room, now) < duration) continue;
      room.position = duration;
      room.playbackState = "paused";
      room.startedAt = null;
      const next = room.queue.shift();
      if (next) this.selectTrack(record, next.trackId);
      room.revision++;
      const { trackId, trackRevision, playbackState, position, startedAt, revision } = room;
      states.push({ roomId: room.id, trackId, trackRevision, playbackState, position, startedAt, revision, serverTime: now });
    }
    return states;
  }

  private clamp(room: Room, position: number): number {
    const duration = room.trackId ? this.duration(room, room.trackId) : undefined;
    return duration === undefined ? position : Math.min(position, duration);
  }
  private duration(room: Room, trackId: string) { return room.library.find(t=>t.id===trackId)?.durationSeconds ?? this.getTrackDuration?.(trackId); }
  private assertAvailable(room: Room, trackId: string) {
    if ((this.getTrackDuration || trackId.startsWith("upload_")) && this.duration(room,trackId) === undefined) throw new RoomError("TRACK_NOT_FOUND", "Track is not in this room library");
  }
  private selectTrack(record: RoomRecord, trackId: string | null) {
    Object.assign(record.room,{trackId,playbackState:"paused",position:0,startedAt:null,trackRevision:record.room.revision+1});
    for (const session of record.sessions.values()) { session.participant.readiness=this.unready(record.room.trackRevision);session.readyAt=null;session.readySequence=-1; }
  }

  /** Called periodically by the composition root and lazily before create/join. */
  sweep(now = this.now()): void {
    for (const [id, record] of this.rooms) {
      for (const [token, session] of record.sessions) {
        if (session.expiresAt !== null && session.expiresAt <= now) record.sessions.delete(token);
      }
      if (record.emptySince !== null && now - record.emptySince >= this.emptyRoomTtlMs) this.rooms.delete(id);
    }
  }

  private now(): number {
    // A backwards wall-clock adjustment must not rewind an established timeline.
    this.lastTime = Math.max(this.lastTime, this.clock());
    return this.lastTime;
  }

  private uniqueId(size: number, occupied: (candidate: string) => boolean): string {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = this.generateId(size);
      if (!occupied(candidate)) return candidate;
    }
    throw new RoomError("ID_EXHAUSTED", "Could not allocate a unique identifier");
  }

  private assertVacant(connectionId: string): void {
    if (this.connections.has(connectionId)) throw new RoomError("ALREADY_IN_ROOM", "Leave the current room first");
  }

  private requireRoom(roomId: string): RoomRecord {
    const record = this.rooms.get(roomId);
    if (!record) throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    return record;
  }

  private member(connectionId: string, roomId: string) {
    const record = this.requireRoom(roomId);
    const connection = this.connections.get(connectionId);
    const session = connection?.roomId === roomId ? record.sessions.get(connection.token) : undefined;
    if (!session || session.connectionId !== connectionId) throw new RoomError("NOT_MEMBER", "Join this room first");
    return { record, session };
  }

  private assertCapacity(record: RoomRecord): void {
    if (record.room.participants.length >= this.maxParticipants) throw new RoomError("ROOM_FULL", "Room is full");
  }

  private assertRevision(room: Room, expectedRevision: number): void {
    if (expectedRevision !== room.revision) {
      throw new RoomError("STALE_REVISION", "Fetch a fresh room snapshot before retrying", room.revision);
    }
  }

  private assertTrack(room: Room): void {
    if (room.trackId === null) throw new RoomError("NO_TRACK", "Select a track first");
  }

  private attach(record: RoomRecord, connectionId: string, token: string, participantId: string): void {
    this.connections.set(connectionId, { roomId: record.room.id, token });
    record.emptySince = null;
    record.room.hostId ??= participantId;
    record.room.revision++;
  }

  private snapshot(record: RoomRecord, serverTime: number): RoomSnapshot {
    return { room: structuredClone(record.room), serverTime };
  }

  private joinResult(record: RoomRecord, token: string, resumed: boolean, participantJoined: boolean, now: number): JoinResult {
    const session = record.sessions.get(token)!;
    return {
      membership: { snapshot: this.snapshot(record, now), participantId: session.participant.id, resumeToken: token, resumed },
      participantJoined,
    };
  }

  private removeConnection(connectionId: string, reason: "leave" | "disconnect" | "kick", now: number): LeaveResult | null {
    const connection = this.connections.get(connectionId);
    if (!connection) return null; // Includes a late disconnect from a replaced connection.
    const { record, session } = this.member(connectionId, connection.roomId);
    this.connections.delete(connectionId);
    if (reason !== "disconnect") record.sessions.delete(connection.token);
    else {
      session.connectionId = null;
      session.expiresAt = now + this.reconnectGraceMs;
    }
    record.room.participants = record.room.participants.filter((participant) => participant.id !== session.participant.id);
    if (record.room.hostId === session.participant.id) record.room.hostId = record.room.participants[0]?.id ?? null;
    if (record.room.participants.length === 0) {
      record.room.position = this.clamp(record.room, this.sync.positionAt(record.room, now));
      record.room.playbackState = "paused";
      record.room.startedAt = null;
      record.emptySince = now;
    }
    record.room.revision++;
    return {
      snapshot: this.snapshot(record, now),
      event: {
        roomId: record.room.id, participantId: session.participant.id, hostId: record.room.hostId,
        reason, revision: record.room.revision, serverTime: now,
      },
    };
  }

  private mutate(connectionId: string, input: RevisionCommand, update: (room: Room, now: number) => void, hostOnly = true): PlaybackState {
    const { record, session } = this.member(connectionId, input.roomId);
    if (hostOnly && record.room.hostId !== session.participant.id) throw new RoomError("NOT_HOST", "Only the host controls playback");
    this.assertRevision(record.room, input.expectedRevision);
    const now = this.now();
    update(record.room, now);
    record.room.revision++;
    const { trackId, trackRevision, playbackState, position, startedAt, revision } = record.room;
    return { roomId: record.room.id, trackId, trackRevision, playbackState, position, startedAt, revision, serverTime: now };
  }
}

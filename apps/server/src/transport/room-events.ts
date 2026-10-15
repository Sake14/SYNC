import type { Server, Socket } from "socket.io";
import type { z } from "zod";
import {
  clockPingSchema, playerPauseSchema, playerPlaySchema, playerSeekSchema, playerReadySchema, queueAddSchema, queueRemoveSchema, queueMoveSchema, reactionSendSchema, revisionCommandSchema,
  roomCreateSchema, roomJoinSchema, roomLeaveSchema, roomRequestSchema, syncPingSchema, trackChangeSchema, participantCommandSchema,
  type Acknowledge, type ClientToServerEvents, type PlaybackState, type ServerToClientEvents,
} from "@sync/shared";
import { RoomError } from "../rooms/room-error.js";
import { RoomManager, type JoinResult, type LeaveResult } from "../rooms/room-manager.js";

type RoomServer = Server<ClientToServerEvents, ServerToClientEvents>;
type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
// Namespace room IDs so a malicious ID cannot target a Socket.IO private socket room.
const channel = (roomId: string) => `music:${roomId}`;

/** Transport only: validation, acknowledgements and room-scoped broadcasts. */
export function bindRoomEvents(io: RoomServer, socket: RoomSocket, rooms: RoomManager): void {
  function handle<Input, Output>(schema: z.ZodType<Input>, action: (payload: Input) => Output) {
    return (payload: Input, ack: Acknowledge<Output>) => {
      // Never perform an unacknowledged mutation (and never call an untrusted non-function).
      if (typeof ack !== "function" || !socket.connected) return;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: { code: "INVALID_PAYLOAD", message: "Invalid event payload" } });
        return;
      }
      try {
        ack({ ok: true, data: action(parsed.data) });
      } catch (error) {
        if (error instanceof RoomError) ack({ ok: false, error: error.toPayload() });
        else {
          // Never log input data or resume credentials.
          console.error("Unexpected room command error");
          ack({ ok: false, error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } });
        }
      }
    };
  }

  function joined(result: JoinResult) {
    const { membership, participantJoined, replacedConnectionId } = result;
    const { room, serverTime } = membership.snapshot;
    // The single-process in-memory adapter joins synchronously. No awaits may split
    // membership mutation, transport registration and broadcasting in this handler.
    void socket.join(channel(room.id));
    if (replacedConnectionId) io.sockets.sockets.get(replacedConnectionId)?.disconnect(true);
    if (participantJoined) {
      io.to(channel(room.id)).emit("participant:joined", {
        roomId: room.id,
        participant: room.participants.find((participant) => participant.id === membership.participantId)!,
        hostId: room.hostId!, revision: room.revision, serverTime,
      });
    }
    io.to(channel(room.id)).emit("room:snapshot", membership.snapshot);
    return membership; // Private resumeToken is sent only in this connection's ack.
  }

  function left(result: LeaveResult) {
    io.to(channel(result.event.roomId)).emit("participant:left", result.event);
    io.to(channel(result.event.roomId)).emit("room:snapshot", result.snapshot);
    return result.snapshot;
  }

  function playerChanged(state: PlaybackState) {
    io.to(channel(state.roomId)).emit("player:state", state);
    return state;
  }

  socket.on("room:create", handle(roomCreateSchema, (input) => joined(rooms.create(socket.id, input))));
  socket.on("room:join", handle(roomJoinSchema, (input) => joined(rooms.join(socket.id, input))));
  socket.on("room:leave", handle(roomLeaveSchema, (input) => {
    const result = rooms.leave(socket.id, input);
    void socket.leave(channel(input.roomId));
    return left(result);
  }));
  socket.on("room:snapshot", handle(roomRequestSchema, (input) => {
    const snapshot = rooms.getSnapshot(socket.id, input);
    socket.emit("room:snapshot", snapshot);
    return snapshot;
  }));
  socket.on("room:transfer-host", handle(participantCommandSchema, input => {
    const snapshot = rooms.transferHost(socket.id, input);
    io.to(channel(input.roomId)).emit("room:snapshot", snapshot);
    return snapshot;
  }));
  socket.on("room:kick", handle(participantCommandSchema, input => {
    const result = rooms.kick(socket.id, input);
    const removed = io.sockets.sockets.get(result.connectionId);
    void removed?.leave(channel(input.roomId));
    removed?.emit("room:removed", { roomId: input.roomId, reason: "kicked", revision: result.snapshot.room.revision, serverTime: result.snapshot.serverTime });
    left(result);
    removed?.disconnect(true);
    return result.snapshot;
  }));
  socket.on("player:play", handle(playerPlaySchema, (input) => playerChanged(rooms.play(socket.id, input))));
  const broadcast = (snapshot: ReturnType<RoomManager["getSnapshot"]>) => { io.to(channel(snapshot.room.id)).emit("room:snapshot",snapshot); return snapshot; };
  socket.on("queue:add", handle(queueAddSchema, input=>broadcast(rooms.addToQueue(socket.id,input))));
  socket.on("queue:remove", handle(queueRemoveSchema, input=>broadcast(rooms.removeFromQueue(socket.id,input))));
  socket.on("queue:move", handle(queueMoveSchema, input=>broadcast(rooms.moveQueueEntry(socket.id,input))));
  socket.on("queue:next", handle(revisionCommandSchema, input=>broadcast(rooms.nextInQueue(socket.id,input))));
  socket.on("reaction:send", handle(reactionSendSchema, input=>{ const reaction=rooms.react(socket.id,input);io.to(channel(input.roomId)).emit("reaction:received",reaction);return reaction; }));
  socket.on("player:pause", handle(playerPauseSchema, (input) => playerChanged(rooms.pause(socket.id, input))));
  socket.on("player:seek", handle(playerSeekSchema, (input) => playerChanged(rooms.seek(socket.id, input))));
  socket.on("player:ready", handle(playerReadySchema, (input) => {
    const snapshot = rooms.reportReady(socket.id, input);
    io.to(channel(input.roomId)).emit("room:snapshot", snapshot);
    return snapshot;
  }));
  socket.on("track:change", handle(trackChangeSchema, (input) => {
    const state = rooms.changeTrack(socket.id, input);
    io.to(channel(input.roomId)).emit("track:change", state);
    return playerChanged(state);
  }));
  socket.on("sync:ping", handle(syncPingSchema, (input) => {
    const serverReceivedAtMs = rooms.serverNow();
    const snapshot = rooms.getSnapshot(socket.id, input);
    const pong = { ...input, serverReceivedAtMs, serverSentAtMs: rooms.serverNow(), revision: snapshot.room.revision };
    socket.emit("sync:pong", pong);
    return pong;
  }));
  socket.on("clock:ping", handle(clockPingSchema, (input) => ({
    ...input, serverReceivedAtMs: rooms.serverNow(), serverSentAtMs: rooms.serverNow(),
  })));
  socket.on("disconnect", () => {
    const result = rooms.disconnect(socket.id);
    if (result) left(result);
  });
}

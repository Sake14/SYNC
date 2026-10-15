import { createServer as createHttpServer } from "node:http";
import { Server } from "socket.io";
import { PROTOCOL_VERSION, type ClientToServerEvents, type ServerToClientEvents } from "@sync/shared";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";
import { RoomManager } from "./rooms/room-manager.js";
import { bindRoomEvents } from "./transport/room-events.js";
import { MusicCatalog } from "./catalog/catalog.js";
import { UploadStore } from "./uploads/upload-store.js";
import type { MusicProviders } from "./providers/registry.js";

export function createServer(config: ServerConfig, rooms = new RoomManager(config.rooms), catalog = new MusicCatalog(), uploads = new UploadStore(config.uploads), providers?: MusicProviders) {
  const app = createApp(config, catalog, {rooms,uploads,broadcast:snapshot=>io.to(`music:${snapshot.room.id}`).emit("room:snapshot",snapshot)}, providers);
  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: config.clientOrigins, methods: ["GET", "POST"] },
    maxHttpBufferSize: 16_384,
    // CORS alone does not restrict WebSocket handshakes.
    allowRequest: (req, callback) => {
      callback(null, !req.headers.origin || config.clientOrigins.includes(req.headers.origin));
    },
  });
  io.on("connection", (socket) => {
    socket.emit("server:ready", { protocolVersion: PROTOCOL_VERSION, serverTimeMs: rooms.serverNow() });
    bindRoomEvents(io, socket, rooms);
  });
  const cleanup = setInterval(() => {
    rooms.sweep();
    for (const snapshot of rooms.expireReadiness()) io.to(`music:${snapshot.room.id}`).emit("room:snapshot", snapshot);
    for (const state of rooms.finishTracks()) { io.to(`music:${state.roomId}`).emit("player:state", state); io.to(`music:${state.roomId}`).emit("room:snapshot",rooms.getBroadcastSnapshot(state.roomId)); }
  }, 250);
  cleanup.unref();
  const mediaCleanup=setInterval(()=>{void uploads.sweep(id=>rooms.hasRoom(id));},60_000);mediaCleanup.unref();
  return {
    app, httpServer, io,
    close: () => new Promise<void>((resolve) => {
      clearInterval(cleanup);
      clearInterval(mediaCleanup);
      io.close(() => resolve());
    }),
  };
}

import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { PROTOCOL_VERSION, type Health } from "@sync/shared";
import type { ServerConfig } from "./config.js";
import { MusicCatalog } from "./catalog/catalog.js";
import type { RoomManager } from "./rooms/room-manager.js";
import { RoomError } from "./rooms/room-error.js";
import { UploadError, type UploadStore } from "./uploads/upload-store.js";
import { bindUploadRoutes } from "./uploads/upload-routes.js";
import { ZodError } from "zod";
import type { RoomSnapshot } from "@sync/shared";
import { createMusicProviders, type MusicProviders } from "./providers/registry.js";
import { bindMusicProviderRoutes } from "./providers/http.js";

export function createApp(config: ServerConfig, catalog = new MusicCatalog(), product?: {rooms:RoomManager;uploads:UploadStore;broadcast:(snapshot:RoomSnapshot)=>void}, providers: MusicProviders = createMusicProviders(catalog, product?.rooms)) {
  const app = express();
  const startedAt = performance.now();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.clientOrigins, methods: ["GET", "POST", "OPTIONS"],allowedHeaders:["Content-Type","Authorization","X-Upload-Size"] }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/health", (_req, res) => {
    const health: Health = {
      status: "ok",
      service: "listen-together-server",
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
      uptimeSeconds: (performance.now() - startedAt) / 1000,
    };
    res.json(health);
  });
  app.get("/api/catalog", (_req, res) => res.json({ tracks: catalog.list() }));
  bindMusicProviderRoutes(app, providers, product?.rooms);
  if(product)bindUploadRoutes(app,product.rooms,product.uploads,product.broadcast);
  app.use("/media", (req, res, next) => {
    const file = catalog.file(`/media${req.path}`);
    if (!file || !["GET", "HEAD"].includes(req.method)) { next(); return; }
    res.sendFile(file, { dotfiles: "deny", cacheControl: false }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if(error instanceof UploadError){res.status(error.status).json({error:{code:error.code,message:error.message}});return;}
    if(error instanceof RoomError){res.status(error.code==="ROOM_NOT_FOUND"?404:403).json({error:{code:error.code,message:"Нет доступа к комнате."}});return;}
    if(error instanceof ZodError){res.status(400).json({error:{code:"INVALID_PAYLOAD",message:"Некорректный запрос."}});return;}
    const status = error.status === 416 ? 416 : error.status === 404 ? 404 : 500;
    res.status(status).json({ error: { code: status === 416 ? "INVALID_RANGE" : status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR", message: "Resource unavailable" } });
  };
  app.use(onError);
  return app;
}

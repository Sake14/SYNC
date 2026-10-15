import multer from "multer";
import { resolve } from "node:path";
import type { Express, Request } from "express";
import { z } from "zod";
import { roomAccessSchema, roomIdSchema, trackSchema, type RoomSnapshot } from "@sync/shared";
import { RoomManager } from "../rooms/room-manager.js";
import { RoomError } from "../rooms/room-error.js";
import { UploadStore, UploadError } from "./upload-store.js";

function access(req:Request,roomId:string,rooms:RoomManager) {
  const data=roomAccessSchema.safeParse({roomId,resumeToken:req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32})$/)?.[1]});
  if(!data.success)throw new UploadError("UNAUTHORIZED",401,"Войдите в комнату перед загрузкой или прослушиванием.");
  return {connectionId:rooms.authorizeToken(roomId,data.data.resumeToken), token:data.data.resumeToken};
}
export function bindUploadRoutes(app:Express,rooms:RoomManager,store:UploadStore,broadcast:(snapshot:RoomSnapshot)=>void) {
  app.get("/api/rooms/:roomId/library",(req,res)=>{
    const roomId=roomIdSchema.parse(req.params.roomId);const {connectionId}=access(req,roomId,rooms);
    res.json({tracks:rooms.getSnapshot(connectionId,{roomId}).room.library,limits:{maxFileBytes:store.options.maxFileBytes,maxRoomBytes:store.options.maxRoomBytes,maxRoomFiles:store.options.maxRoomFiles}});
  });
  const storage=multer.diskStorage({destination:(_req,_file,cb)=>cb(null,store.tempDir),filename:(req,_file,cb)=>{const name=store.tempName();req.res!.locals.uploadTemp=resolve(store.tempDir,name);cb(null,name);}});
  app.post("/api/rooms/:roomId/uploads",async(req,res)=>{
    let release:(()=>void)|undefined;let committed:string|undefined;
    const deadline=setTimeout(()=>req.destroy(),120_000);deadline.unref();
    try {
      const roomId=roomIdSchema.parse(req.params.roomId);const {token}=access(req,roomId,rooms);
      const declared=req.headers["x-upload-size"];
      const size=z.coerce.number().int().positive().max(store.options.maxFileBytes).safeParse(declared??store.options.maxFileBytes);
      if(!size.success)throw new UploadError("UPLOAD_TOO_LARGE",413,"Некорректный размер или превышен лимит файла.");
      await store.prepare(); release=store.reserve(roomId,size.data);
      // A size hint can only tighten the enforced byte limit, never relax it.
      const upload=multer({storage,limits:{fileSize:size.data+1,files:1,fields:2,fieldSize:800,parts:3}}).single("file");
      await new Promise<void>((resolve,reject)=>{const aborted=()=>reject(new UploadError("UPLOAD_ABORTED",400,"Загрузка прервалась."));req.once("aborted",aborted);upload(req,res,error=>{req.off("aborted",aborted);if(error)reject(error);else resolve();});});
      if(!req.file)throw new UploadError("INVALID_FILE",400,"Выберите аудиофайл.");
      if(req.file.size>size.data)throw new UploadError("UPLOAD_TOO_LARGE",413,"Файл превышает допустимый размер.");
      const metadata=z.strictObject({title:trackSchema.shape.title.optional(),artist:trackSchema.shape.artist.optional()}).parse(req.body);
      rooms.authorizeToken(roomId,token);
      const entry=await store.commit(req.file.path,roomId,metadata);committed=entry.filename;
      // Committed bytes already count toward storage; do not count their reservation twice.
      release?.(); release=undefined;
      const connectionId=rooms.authorizeToken(roomId,token);
      const snapshot=rooms.addLibraryTrack(connectionId,roomId,entry.track);
      broadcast(snapshot); committed=undefined;
      res.status(201).json({track:entry.track});
    } catch(error) {
      if(committed) await store.remove(committed).catch(()=>{});
      if(req.file)await store.discardTemp(req.file.path);
      const fault=error instanceof UploadError?error:error instanceof multer.MulterError?new UploadError(error.code==="LIMIT_FILE_SIZE"?"UPLOAD_TOO_LARGE":"INVALID_FILE",error.code==="LIMIT_FILE_SIZE"?413:400,error.code==="LIMIT_FILE_SIZE"?"Файл превышает допустимый размер.":"Нужен один файл и корректные метаданные."):error instanceof RoomError?new UploadError(error.code,error.code==="ROOM_NOT_FOUND"?404:403,"Нет доступа к этой комнате."):new UploadError("INVALID_FILE",400,"Не удалось обработать загрузку.");
      // Drain rejected multipart bytes without retaining them, so clients receive the HTTP error.
      req.resume();
      if(!res.headersSent)res.status(fault.status).json({error:{code:fault.code,message:fault.message}});
    } finally {clearTimeout(deadline);if(typeof res.locals.uploadTemp==="string")await store.discardTemp(res.locals.uploadTemp);release?.();}
  });
  app.use("/media",(req,res,next)=>{
    const entry=store.get(req.path.slice(1)); if(!entry){if(/^\/room_[A-Za-z0-9_-]{12}_upload_/.test(req.path))res.status(404).end();else next();return;}
    if(!["GET","HEAD"].includes(req.method)){next();return;}
    try{access(req,entry.roomId,rooms);res.type(entry.mime);res.sendFile(entry.filename,{root:store.options.directory,cacheControl:false,dotfiles:"deny"},error=>{if(error&&!res.headersSent)next(error);});}catch(error){next(error);}
  });
}

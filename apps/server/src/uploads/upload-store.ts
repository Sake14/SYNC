import { mkdir, readdir, lstat, realpath, unlink, rename, chmod, open } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { nanoid } from "nanoid";
import { fileTypeFromFile } from "file-type";
import { parseFile } from "music-metadata";
import { trackSchema, type Track } from "@sync/shared";
import type { ServerConfig } from "../config.js";

export class UploadError extends Error { constructor(readonly code:string,readonly status:number,message:string){super(message);} }
type Entry = {roomId:string;path:string;filename:string;bytes:number;mime:string;track:Track};
const ownedPattern = /^room_([A-Za-z0-9_-]{12})_upload_[A-Za-z0-9_-]{32}\.(wav|mp3|ogg|m4a)$/;
export class UploadStore {
  tempDir: string;
  private readonly files = new Map<string,Entry>();
  private readonly existing = new Map<string,{bytes:number;mtime:number}>();
  private readonly pending = new Map<string,number>();
  private readonly reserved = new Map<string,number>();
  private preparing: Promise<void> | null = null;
  private used = 0;
  readonly options: ServerConfig["uploads"];
  constructor(options: ServerConfig["uploads"]) { this.options={...options,directory:resolve(options.directory)};this.tempDir=resolve(options.directory,"tmp"); }
  prepare() { return this.preparing ??= this.initialize(); }
  private async initialize() {
    await mkdir(this.options.directory,{recursive:true,mode:0o700});
    if((await lstat(this.options.directory)).isSymbolicLink())throw new Error("Upload directory must not be a symlink");
    this.options.directory=await realpath(this.options.directory);this.tempDir=resolve(this.options.directory,"tmp");
    await mkdir(this.tempDir,{recursive:true,mode:0o700});
    if((await lstat(this.tempDir)).isSymbolicLink())throw new Error("Temporary upload directory must not be a symlink");
    for (const name of await readdir(this.options.directory)) {
      if (!ownedPattern.test(name)) continue;
      const stat=await lstat(resolve(this.options.directory,name));
      if (stat.isFile()) { this.existing.set(name,{bytes:stat.size,mtime:stat.mtimeMs});this.used+=stat.size; }
    }
  }
  reserve(roomId:string,bytes=this.options.maxFileBytes) {
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>this.options.maxFileBytes)throw new UploadError("UPLOAD_TOO_LARGE",413,"Некорректный размер файла.");
    const pending=this.pending.get(roomId)??0;
    const entries=[...this.files.values()].filter(f=>f.roomId===roomId);
    const totalPending=[...this.pending.values()].reduce((sum,count)=>sum+count,0);
    const reserved=this.reserved.get(roomId)??0;const totalReserved=[...this.reserved.values()].reduce((sum,bytes)=>sum+bytes,0);
    if (totalPending>=4) throw new UploadError("UPLOAD_BUSY",429,"Сервер уже обрабатывает несколько загрузок. Попробуйте позже.");
    if(entries.length+pending>=this.options.maxRoomFiles || entries.reduce((sum,f)=>sum+f.bytes,0)+reserved+bytes>this.options.maxRoomBytes || this.used+totalReserved+bytes>this.options.maxStorageBytes) throw new UploadError("STORAGE_FULL",413,"Лимит музыкальной библиотеки исчерпан.");
    this.pending.set(roomId,pending+1);this.reserved.set(roomId,reserved+bytes);let released=false;
    return ()=>{if(!released){released=true;const left=(this.pending.get(roomId)??1)-1;if(left)this.pending.set(roomId,left);else this.pending.delete(roomId);const remaining=(this.reserved.get(roomId)??bytes)-bytes;if(remaining)this.reserved.set(roomId,remaining);else this.reserved.delete(roomId);}};
  }
  tempName() { return `temp_${nanoid(32)}`; }
  async discardTemp(path:string) {
    if(dirname(path)!==this.tempDir || !/^temp_[A-Za-z0-9_-]{32}$/.test(basename(path))) return;
    await unlink(path).catch(()=>{});
  }
  async commit(path:string,roomId:string,metadata:{title?:string;artist?:string}):Promise<Entry> {
    if(dirname(path)!==this.tempDir || !/^temp_[A-Za-z0-9_-]{32}$/.test(basename(path))) throw new UploadError("INVALID_FILE",400,"Некорректный файл.");
    const stat=await lstat(path);
    if(!stat.isFile() || stat.size===0) throw new UploadError("INVALID_FILE",400,"Нужен непустой аудиофайл.");
    if(stat.size>this.options.maxFileBytes) throw new UploadError("UPLOAD_TOO_LARGE",413,"Файл превышает допустимый размер.");
    const type=await fileTypeFromFile(path);
    const formats:Record<string,{ext:string;mime:string}>={wav:{ext:"wav",mime:"audio/wav"},mp3:{ext:"mp3",mime:"audio/mpeg"},ogg:{ext:"ogg",mime:"audio/ogg"},opus:{ext:"ogg",mime:"audio/ogg"},m4a:{ext:"m4a",mime:"audio/mp4"}};
    const format=type ? formats[type.ext] : undefined;
    if(!format) throw new UploadError("UNSUPPORTED_MEDIA",415,"Поддерживаются настоящие аудиофайлы MP3, WAV, OGG и M4A.");
    if(format.ext==="wav") {
      const file=await open(path,"r"); const header=Buffer.alloc(12);try{await file.read(header,0,12,0);}finally{await file.close();}
      if(header.toString("ascii",0,4)!=="RIFF" || header.toString("ascii",8,12)!=="WAVE" || header.readUInt32LE(4)+8>stat.size) throw new UploadError("INVALID_FILE",415,"WAV повреждён или обрезан.");
    }
    let parsed: Awaited<ReturnType<typeof parseFile>>;
    try {parsed=await parseFile(path,{duration:true,skipCovers:true});} catch {throw new UploadError("INVALID_FILE",415,"Аудиофайл не удалось прочитать.");}
    const duration=parsed.format.duration;
    if(!duration || !Number.isFinite(duration) || duration>4*3600 || !parsed.format.sampleRate || !parsed.format.numberOfChannels || !parsed.format.codec || parsed.format.trackInfo?.some(t=>String(t.type).toLowerCase()==="video")) throw new UploadError("INVALID_FILE",415,"Нужна аудиозапись длительностью до четырёх часов.");
    const id=`upload_${nanoid(32)}`; const filename=`room_${roomId}_${id}.${format.ext}`;
    const track=trackSchema.parse({id,title:metadata.title??parsed.common.title??"Моя композиция",artist:metadata.artist??parsed.common.artist??"Музыка участников",durationSeconds:duration,cover:"pulse",streamPath:`/media/${filename}`});
    const target=resolve(this.options.directory,filename);
    await rename(path,target);
    try { await chmod(target,0o600); } catch(error) {await unlink(target).catch(()=>{});throw error;}
    const entry={roomId,path:target,filename,bytes:stat.size,mime:format.mime,track}; this.files.set(filename,entry);this.used+=stat.size;
    return entry;
  }
  get(filename:string) { return this.files.get(filename); }
  async remove(filename:string) {const entry=this.files.get(filename);if(!entry)return;try{await unlink(entry.path);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}this.files.delete(filename);this.used-=entry.bytes;}
  async sweep(hasRoom:(roomId:string)=>boolean) {
    for(const [name,entry] of this.files) if(!hasRoom(entry.roomId)) await this.remove(name).catch(()=>{});
    // Files from an earlier process have no surviving room and expire after 24 hours.
    for(const [name,entry] of this.existing) if(Date.now()-entry.mtime>=86400_000){try{await unlink(resolve(this.options.directory,name));this.used-=entry.bytes;this.existing.delete(name);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"){this.used-=entry.bytes;this.existing.delete(name);}}}
  }
}

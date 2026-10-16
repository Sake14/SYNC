"use client";

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import { z } from "zod";
import {
  catalogSchema,
  clockPongSchema,
  membershipSchema,
  playbackStateSchema,
  roomSnapshotSchema,
  errorCodeSchema,
  syncPongSchema,
  roomIdSchema,
  readySchema,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type Room,
  type RoomSnapshot,
  type PlaybackState,
  type Membership,
  type Track,
  type Readiness,
  reactionSchema, uploadResponseSchema, httpErrorSchema, roomLibrarySchema, roomRemovedSchema,
  type Reaction,
} from "@sync/shared";
import {
  ClockOffsetEstimator,
  type ClockEstimate,
} from "@/lib/sync/clock-offset-estimator";
import {
  applyPlaybackState,
  applyRoomSnapshot,
} from "@/lib/sync/apply-playback";
import type { SyncMetrics } from "@/lib/sync/playback-scheduler";
import { mergeRoomTracks } from "@/lib/room-tracks";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type State = {
  room: Room | null;
  participantId: string | null;
  joined: boolean;
  removed: boolean;
  connection: "connecting" | "online" | "offline";
  busy: boolean;
  error: string;
  tracks: Track[];
  catalogTracks: Track[];
  reactions: Reaction[];
  mediaRoomId: string | null;
  mediaSessionError: string;
  uploadLimits: {maxFileBytes:number;maxRoomBytes:number;maxRoomFiles:number};
  upload: {status:"idle"|"uploading"|"processing"|"done"|"error";progress:number;error:string};
  catalogStatus: "loading" | "ready" | "error";
  clock: ClockEstimate | null;
  rtt: number | null;
  metrics: SyncMetrics | null;
  inboundDelayMs: number;
};
export const useRoomStore = create<State>(() => ({
  room: null,
  participantId: null,
  joined: false,
  removed: false,
  connection: "connecting",
  busy: false,
  error: "",
  tracks: [],
  catalogTracks: [], reactions: [], mediaRoomId: null, mediaSessionError: "",
  uploadLimits:{maxFileBytes:20*1024*1024,maxRoomBytes:100*1024*1024,maxRoomFiles:20},
  upload:{status:"idle",progress:0,error:""},
  catalogStatus: "loading",
  clock: null,
  rtt: null,
  metrics: null,
  inboundDelayMs: 0,
}));
const set = useRoomStore.setState;
const get = useRoomStore.getState;
const credentialSchema = membershipSchema
  .pick({ participantId: true, resumeToken: true })
  .extend({ roomId: roomIdSchema });
const failureSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  currentRevision: z.number().optional(),
});
type Credential = z.infer<typeof credentialSchema>;
let socket: ClientSocket | null = null;
let credential: Credential | null = null;
let targetRoom: string | null = null;
let lastFullRevision = -1;
let generation = 0;
const clockEstimator = new ClockOffsetEstimator();
let clockRequest: object | null = null;
let snapshotClock: { serverTime: number; localTime: number } | null = null;
let readinessSequence = 0;
const pendingDeliveries = new Set<ReturnType<typeof setTimeout>>();
const pendingReadiness = new Set<Promise<boolean>>();
const messages: Record<string, string> = {
  ROOM_NOT_FOUND: "Комната не найдена. Возможно, сервер был перезапущен.",
  ROOM_FULL: "В комнате нет свободных мест.",
  NOT_HOST: "Управлять музыкой может только HOST.",
  NOT_MEMBER: "Сначала войдите в комнату.",
  INVALID_SESSION: "Сессия истекла. Войдите в комнату снова.",
  STALE_REVISION: "Состояние обновилось. Попробуйте действие ещё раз.",
  NO_TRACK: "Сначала выберите трек.",
  NOT_READY: "Дождитесь готовности всех слушателей: буфер, звук и часы.",
  TRACK_NOT_FOUND: "Трек отсутствует в локальном каталоге.",
  ROOM_LIMIT: "На сервере слишком много комнат. Попробуйте позже.",
  ALREADY_IN_ROOM: "Сначала выйдите из текущей комнаты.",
  PARTICIPANT_NOT_FOUND: "Участник уже отключился. Список комнаты обновлён.",
  CANNOT_REMOVE_HOST: "Сначала передайте роль HOST или выйдите из комнаты.",
  QUEUE_FULL:"В очереди уже 50 треков.",QUEUE_EMPTY:"Очередь пока пуста.",NOT_QUEUE_OWNER:"Удалять чужие треки из очереди может HOST.",RATE_LIMIT:"Подождите полсекунды перед следующей реакцией.",LIBRARY_FULL:"Музыкальная библиотека комнаты заполнена.",
};
class CommandFailure extends Error {
  constructor(readonly code: string) {
    super(
      messages[code] ?? "Не удалось выполнить действие. Попробуйте ещё раз.",
    );
  }
}

function saveCredential(value: Credential | null) {
  credential = value;
  try {
    if (value) sessionStorage.setItem("sync-membership", JSON.stringify(value));
    else sessionStorage.removeItem("sync-membership");
  } catch {
    /* Private browsing can disallow storage; current-tab membership still works. */
  }
}
function applySnapshot(value: RoomSnapshot) {
  const parsed = roomSnapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.room.id !== targetRoom) return;
  const current = get().room;
  const result = applyRoomSnapshot(current, parsed.data.room, lastFullRevision);
  lastFullRevision = result.fullRevision;
  if (result.room === current) return;
  snapshotClock = {
    serverTime: parsed.data.serverTime,
    localTime: performance.now(),
  };
  set({ room: result.room, tracks:mergeRoomTracks(get().catalogTracks,result.room.library,get().tracks) });
}
function applyPlayback(value: PlaybackState) {
  const parsed = playbackStateSchema.safeParse(value);
  const current = get().room;
  if (
    !parsed.success ||
    !current ||
    parsed.data.roomId !== current.id ||
    parsed.data.revision < current.revision
  )
    return;
  const room = applyPlaybackState(current, parsed.data);
  if (room !== current) set({ room });
}
function applyMembership(value: Membership) {
  const result = membershipSchema.parse(value);
  targetRoom = result.snapshot.room.id;
  saveCredential({
    roomId: targetRoom,
    participantId: result.participantId,
    resumeToken: result.resumeToken,
  });
  applySnapshot(result.snapshot);
  set({ participantId: result.participantId, joined: true, removed: false, error: "" });
  set({reactions:[],mediaRoomId:get().mediaRoomId===targetRoom?targetRoom:null,mediaSessionError:"",upload:{status:"idle",progress:0,error:""}});
  void prepareMediaSession();
  void calibrateClock(6);
}

async function request<T>(
  schema: z.ZodType<T>,
  emit: (client: ClientSocket) => Promise<Ack<T>>,
): Promise<T> {
  const client = socket;
  if (!client?.connected)
    throw new Error("Нет связи с сервером. Дождитесь подключения.");
  const connectionId = client.id;
  let ack: Ack<T>;
  try {
    ack = await emit(client);
  } catch {
    throw new Error(
      "Сервер не ответил. Состояние будет обновлено при подключении.",
    );
  }
  if (socket !== client || !client.connected || client.id !== connectionId)
    throw new Error("Связь прервалась. Дождитесь восстановления.");
  const result = z
    .discriminatedUnion("ok", [
      z.strictObject({ ok: z.literal(true), data: schema }),
      z.strictObject({ ok: z.literal(false), error: failureSchema }),
    ])
    .parse(ack);
  if (!result.ok) throw new CommandFailure(result.error.code);
  return result.data;
}

async function ping() {
  const client = socket;
  if (!client?.connected) return;
  const t0 = Date.now();
  const monoSent = performance.now();
  try {
    const data =
      get().joined && credential
        ? await request(syncPongSchema, (s) =>
            s.emitWithAck("sync:ping", {
              roomId: credential!.roomId,
              clientSentAtMs: t0,
            }),
          )
        : await request(clockPongSchema, (s) =>
            s.emitWithAck("clock:ping", { clientSentAtMs: t0 }),
          );
    const t3 = Date.now();
    const monoReceived = performance.now();
    if (socket !== client || data.clientSentAtMs !== t0) return;
    clockEstimator.add({
      t0,
      t1: data.serverReceivedAtMs,
      t2: data.serverSentAtMs,
      t3,
      monoSent,
      monoReceived,
    });
    const estimate = clockEstimator.estimate(monoReceived);
    set({
      clock: estimate,
      rtt: estimate ? Math.round(estimate.rttMs) : null,
    });
  } catch {
    /* Connection events own status; the next clock sample retries. */
  }
}
export function serverNow() {
  const now = performance.now();
  return (
    clockEstimator.serverNow(now) ??
    (snapshotClock
      ? snapshotClock.serverTime + now - snapshotClock.localTime
      : Date.now())
  );
}
export function clockIsReady() {
  return clockEstimator.estimate(performance.now()) !== null;
}
export async function calibrateClock(count = 6) {
  if (clockRequest || !socket?.connected) return;
  const run = {};
  clockRequest = run;
  const client = socket;
  const id = client.id;
  try {
    for (
      let i = 0;
      i < count && socket === client && client.connected && client.id === id;
      i++
    ) {
      await ping();
      if (i < count - 1)
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
    }
  } finally {
    if (clockRequest === run) clockRequest = null;
  }
}
export function publishMetrics(metrics: SyncMetrics | null) {
  set({ metrics });
}
export function setInboundDelay(ms: number) {
  set({ inboundDelayMs: Math.max(0, Math.min(5000, Math.round(ms))) });
}
function deliver<T>(value: T, apply: (payload: T) => void) {
  const delay = get().inboundDelayMs;
  if (!delay) {
    apply(value);
    return;
  }
  const epoch = generation;
  const id = socket?.id;
  const timer = setTimeout(() => {
    pendingDeliveries.delete(timer);
    if (epoch === generation && socket?.connected && socket.id === id)
      apply(value);
  }, delay);
  pendingDeliveries.add(timer);
}
export function reportReadiness(readiness: Readiness): Promise<boolean> {
  if (get().busy) return Promise.resolve(false);
  const task = sendReadiness(readiness);
  pendingReadiness.add(task);
  void task.finally(() => pendingReadiness.delete(task));
  return task;
}
async function sendReadiness(readiness: Readiness) {
  const state = get();
  if (
    !state.joined ||
    !state.room?.trackId ||
    state.room.trackRevision !== readiness.trackRevision ||
    !socket?.connected
  )
    return false;
  try {
    const snapshot = await request(roomSnapshotSchema, (s) =>
      s.emitWithAck("player:ready", {
        ...readiness,
        roomId: state.room!.id,
        trackId: state.room!.trackId!,
        sequence: ++readinessSequence,
      }),
    );
    deliver(snapshot, applySnapshot);
    return true;
  } catch {
    return false;
  }
}

export async function loadTracks() {
  set({ catalogStatus: "loading" });
  try {
    const response = await fetch("/api/catalog", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error("Unavailable");
    const catalogTracks=catalogSchema.parse(await response.json()).tracks;
    set({catalogTracks,tracks:mergeRoomTracks(catalogTracks,get().room?.library??[],get().tracks),catalogStatus:"ready"});
  } catch {
    set({ catalogStatus: "error" });
  }
}

export function startTransport() {
  const epoch = ++generation;
  try {
    const stored = sessionStorage.getItem("sync-membership");
    credential = stored ? credentialSchema.parse(JSON.parse(stored)) : null;
  } catch {
    credential = null;
  }
  targetRoom = credential?.roomId ?? null;
  const origin =
    process.env.NEXT_PUBLIC_SOCKET_URL ??
    `${location.protocol}//${location.hostname}:4000`;
  const client: ClientSocket = io(origin, {
    autoConnect: false,
    timeout: 4000,
    ackTimeout: 4000,
  });
  socket = client;
  set({ busy: !!credential });
  client.on("room:snapshot", (value) => deliver(value, applySnapshot));
  client.on("player:state", (value) => deliver(value, applyPlayback));
  client.on("reaction:received", receiveReaction);
  client.on("room:removed", payload => {
    const parsed = roomRemovedSchema.safeParse(payload);
    if (!parsed.success || parsed.data.roomId !== get().room?.id) return;
    saveCredential(null); targetRoom = null; uploadRequest?.abort();
    set({ room: null, participantId: null, joined: false, removed: true, busy: false,
      mediaRoomId: null, tracks: get().catalogTracks, reactions: [], error: "HOST исключил вас из комнаты." });
  });
  client.on("server:ready", async (payload) => {
    if (!readySchema.safeParse(payload).success) {
      set({
        connection: "offline",
        error:
          "Несовместимая версия протокола. Перезапустите backend и обновите страницу.",
      });
      client.disconnect();
      return;
    }
    snapshotClock = {
      serverTime: payload.serverTimeMs,
      localTime: performance.now(),
    };
    clockEstimator.reset();
    clockRequest = null;
    set({ connection: "online", clock: null, rtt: null });
    if (credential) {
      set({ busy: true });
      try {
        const membership = await request(membershipSchema, (s) =>
          s.emitWithAck("room:join", {
            roomId: credential!.roomId,
            resumeToken: credential!.resumeToken,
          }),
        );
        if (epoch === generation) applyMembership(membership);
      } catch (error) {
        if (epoch !== generation) return;
        if (error instanceof CommandFailure) saveCredential(null);
        set({
          error:
            error instanceof Error
              ? error.message
              : "Не удалось восстановить комнату",
          joined: false,
        });
      } finally {
        if (epoch === generation) set({ busy: false });
      }
    }
    void calibrateClock(6);
  });
  const offline = () => {
    const interrupted=uploadRequest!==null;uploadRequest?.abort();
    set({ connection: "offline", joined: false, busy: false, ...(interrupted?{upload:{status:"error" as const,progress:0,error:"Соединение прервалось. Повторите загрузку после подключения."}}:{}) });
  };
  client.on("disconnect", (reason) => {
    offline();
    if (reason === "io server disconnect" && !get().removed) {
      saveCredential(null);
      set({
        error:
          "Сессия открыта в другом подключении. Войдите снова, чтобы слушать здесь.",
      });
    }
  });
  client.on("connect_error", offline);
  client.connect();
  void loadTracks();
  const interval = setInterval(() => {
    void calibrateClock(clockIsReady() ? 1 : 6);
  }, 5000);
  const foreground = () => {
    if (document.visibilityState === "visible") {
      void calibrateClock(6);
      void refreshSnapshot();
    }
  };
  document.addEventListener("visibilitychange", foreground);
  return () => {
    generation++;
    clearInterval(interval);
    document.removeEventListener("visibilitychange", foreground);
    for (const timer of pendingDeliveries) clearTimeout(timer);
    pendingDeliveries.clear();
    clockEstimator.reset();
    clockRequest = null;
    client.removeAllListeners();
    client.disconnect();
    if (socket === client) socket = null;
  };
}
export function reconnect() {
  set({ connection: "connecting", error: "" });
  socket?.connect();
}
export function clearError() {
  set({ error: "" });
}

async function action<T>(run: () => Promise<T>): Promise<T | null> {
  if (get().busy) return null;
  set({ busy: true, error: "" });
  try {
    // Drain our own in-flight reports before taking a command revision; keep server guards intact.
    await Promise.all([...pendingReadiness]);
    return await run();
  } catch (error) {
    if (get().removed) return null;
    set({
      error:
        error instanceof Error
          ? error.message
          : "Не удалось выполнить действие",
    });
    if (error instanceof CommandFailure && error.code === "STALE_REVISION")
      await refreshSnapshot();
    return null;
  } finally {
    set({ busy: false });
  }
}
async function refreshSnapshot() {
  if (!credential || !get().joined) return;
  try {
    deliver(
      await request(roomSnapshotSchema, (s) =>
        s.emitWithAck("room:snapshot", { roomId: credential!.roomId }),
      ),
      applySnapshot,
    );
  } catch {
    /* Report original command failure. */
  }
}
export async function createRoom(displayName: string, name: string) {
  return action(async () => {
    const result = await request(membershipSchema, (s) =>
      s.emitWithAck("room:create", { displayName, name }),
    );
    applyMembership(result);
    return result.snapshot.room.id;
  });
}
export async function joinRoom(roomId: string, displayName: string) {
  return action(async () => {
    targetRoom = roomId;
    const result = await request(membershipSchema, (s) =>
      s.emitWithAck("room:join", { roomId, displayName }),
    );
    applyMembership(result);
    return result.snapshot.room.id;
  });
}
export async function leaveRoom() {
  return action(async () => {
    const room = get().room;
    if (!room || !get().joined)
      throw new Error("Дождитесь восстановления соединения, чтобы выйти.");
    await request(roomSnapshotSchema, (s) =>
      s.emitWithAck("room:leave", {
        roomId: room.id,
        expectedRevision: room.revision,
      }),
    );
    saveCredential(null);
    uploadRequest?.abort();
    targetRoom = null;
    set({ room: null, participantId: null, joined: false });
    set({tracks:get().catalogTracks,reactions:[],mediaRoomId:null});
    void fetch(`/api/rooms/${room.id}/session`,{method:"DELETE"}).catch(()=>{});
    return true;
  });
}
export async function controlPlayer(
  command: "play" | "pause" | "seek" | "track",
  value?: number | string,
) {
  return action(async () => {
    const state = get();
    if (!state.room || !state.joined)
      throw new Error("Нет подключения к комнате.");
    const payload = {
      roomId: state.room.id,
      expectedRevision: state.room.revision,
    };
    const result = await request(playbackStateSchema, (s) => {
      if (command === "play") return s.emitWithAck("player:play", payload);
      if (command === "pause") return s.emitWithAck("player:pause", payload);
      if (command === "seek")
        return s.emitWithAck("player:seek", {
          ...payload,
          position: Number(value),
        });
      return s.emitWithAck("track:change", {
        ...payload,
        trackId: String(value),
      });
    });
    deliver(result, applyPlayback);
    return true;
  });
}

export async function controlParticipant(command: "kick" | "transfer", participantId: string) {
  return action(async () => {
    const state = get();
    if (!state.room || !state.joined) throw new Error("Нет подключения к комнате.");
    const input = { roomId: state.room.id, expectedRevision: state.room.revision, participantId };
    const snapshot = await request(roomSnapshotSchema, s => command === "kick"
      ? s.emitWithAck("room:kick", input) : s.emitWithAck("room:transfer-host", input));
    deliver(snapshot, applySnapshot);
    return true;
  });
}

export async function prepareMediaSession() {
  const access=credential; if(!access||!get().joined)return false;
  set({mediaSessionError:""});
  try{
    const response=await fetch(`/api/rooms/${access.roomId}/session`,{method:"POST",headers:{Authorization:`Bearer ${access.resumeToken}`},cache:"no-store",signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw new Error("Не удалось подключить музыку комнаты. Повторите попытку.");
    const library=roomLibrarySchema.parse(await response.json());
    if(credential!==access||!get().joined)return false;
    set({mediaRoomId:access.roomId,mediaSessionError:"",uploadLimits:library.limits});return true;
  }catch{if(credential===access&&get().mediaRoomId!==access.roomId)set({mediaSessionError:"Не удалось подключить музыку комнаты. Проверьте сеть и повторите подключение."});return false;}
}
function receiveReaction(payload:Reaction) {
  const parsed=reactionSchema.safeParse(payload);const state=get();
  if(!parsed.success||parsed.data.roomId!==state.room?.id||!state.joined||state.reactions.some(r=>r.id===parsed.data.id))return;
  set({reactions:[...state.reactions.slice(-9),parsed.data]});
}
export async function sendReaction(emoji:Reaction["emoji"]) {
  const room=get().room;if(!room||!get().joined)return;
  try{receiveReaction(await request(reactionSchema,s=>s.emitWithAck("reaction:send",{roomId:room.id,emoji})));}
  catch(error){set({error:error instanceof Error?error.message:"Не удалось отправить реакцию"});}
}
export async function controlQueue(command:"add"|"remove"|"up"|"down"|"next",value?:string) {
  return action(async()=>{
    const room=get().room;if(!room||!get().joined)throw new Error("Войдите в комнату.");
    const base={roomId:room.id,expectedRevision:room.revision};
    const snapshot=await request(roomSnapshotSchema,s=>{
      if(command==="add")return s.emitWithAck("queue:add",{...base,trackId:value!});
      if(command==="remove")return s.emitWithAck("queue:remove",{...base,entryId:value!});
      if(command==="next")return s.emitWithAck("queue:next",base);
      return s.emitWithAck("queue:move",{...base,entryId:value!,direction:command==="up"?"up":"down"});
    });deliver(snapshot,applySnapshot);return true;
  });
}
let uploadRequest:XMLHttpRequest|null=null;
export function cancelUpload(){uploadRequest?.abort();}
export async function uploadTrack(file:File,title:string) {
  const access=credential;
  if(!access||!get().joined){set({upload:{status:"error",progress:0,error:"Войдите в комнату."}});return;}
  if(file.size>get().uploadLimits.maxFileBytes){set({upload:{status:"error",progress:0,error:`Файл больше ${Math.round(get().uploadLimits.maxFileBytes/1024/1024)} МБ.`}});return;}
  if(uploadRequest)return;
  set({upload:{status:"uploading",progress:0,error:""}});
  await new Promise<void>(resolve=>{
    const xhr=new XMLHttpRequest();uploadRequest=xhr;const body=new FormData();body.append("file",file);body.append("title",title.trim()||"Моя композиция");
    xhr.open("POST",`/api/rooms/${access.roomId}/uploads`);xhr.setRequestHeader("Authorization",`Bearer ${access.resumeToken}`);xhr.setRequestHeader("X-Upload-Size",String(file.size));xhr.timeout=120_000;
    const valid=()=>credential===access&&get().joined;
    const fail=(message:string)=>{if(valid())set({upload:{status:"error",progress:0,error:message}});};
    xhr.upload.onprogress=event=>{if(valid()&&event.lengthComputable){const progress=Math.round(event.loaded/event.total*100);set({upload:{status:progress===100?"processing":"uploading",progress,error:""}});}};
    xhr.onload=()=>{if(!valid())return;try{const response=JSON.parse(xhr.responseText);if(xhr.status!==201){const parsed=httpErrorSchema.safeParse(response);throw new Error(parsed.success?parsed.data.error.message:"Сервер отклонил загрузку.");}uploadResponseSchema.parse(response);set({mediaRoomId:access.roomId,upload:{status:"done",progress:100,error:""}});}catch(error){fail(error instanceof Error?error.message:"Не удалось загрузить аудио.");}};
    xhr.onerror=()=>fail("Связь прервалась. Загрузите файл снова после подключения.");xhr.ontimeout=()=>fail("Загрузка заняла слишком много времени. Попробуйте ещё раз.");xhr.onabort=()=>fail("Загрузка отменена.");
    xhr.onloadend=()=>{uploadRequest=null;resolve();};xhr.send(body);
  });
}

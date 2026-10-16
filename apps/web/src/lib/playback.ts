import { SyncEngine, type Room } from "@sync/shared";

export function positionAt(
  room: Pick<Room, "position" | "playbackState" | "startedAt">,
  serverNow: number,
  duration: number,
) {
  return new SyncEngine().positionAt(room, serverNow, duration);
}
export function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
export function clockSample(t0: number, t1: number, t2: number, t3: number) {
  const rtt = t3 - t0 - (t2 - t1);
  if (rtt < 0 || rtt > 2000 || t2 < t1) return null;
  return { rtt, offset: (t1 - t0 + (t2 - t3)) / 2 };
}

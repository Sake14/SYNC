import type { Track } from "@sync/shared";

/** Unchanged snapshot metadata must not replace the track used by the audio lifecycle. */
export function mergeRoomTracks(catalog: Track[], library: Track[], previous: Track[]): Track[] {
  return [...catalog, ...library].map(track => {
    const prior = previous.find(item => item.id === track.id);
    return prior && prior.title === track.title && prior.artist === track.artist &&
      prior.durationSeconds === track.durationSeconds && prior.streamPath === track.streamPath && prior.cover === track.cover ? prior : track;
  });
}

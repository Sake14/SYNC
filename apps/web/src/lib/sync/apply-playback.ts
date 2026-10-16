import type { Room, PlaybackState } from "@sync/shared";

export function applyPlaybackState(
  room: Room | null,
  state: PlaybackState,
): Room | null {
  if (!room || state.roomId !== room.id || state.revision < room.revision)
    return room;
  const {
    trackId,
    trackRevision,
    position,
    startedAt,
    playbackState,
    revision,
  } = state;
  return {
    ...room,
    trackId,
    trackRevision,
    position,
    startedAt,
    playbackState,
    revision,
  };
}

/** A newer partial timeline must not discard still-needed membership metadata. */
export function applyRoomSnapshot(
  current: Room | null,
  snapshot: Room,
  lastFullRevision: number,
) {
  if (!current || current.id !== snapshot.id)
    return { room: snapshot, fullRevision: snapshot.revision };
  if (snapshot.revision < lastFullRevision)
    return { room: current, fullRevision: lastFullRevision };
  if (snapshot.revision >= current.revision)
    return { room: snapshot, fullRevision: snapshot.revision };
  const {
    trackId,
    trackRevision,
    position,
    startedAt,
    playbackState,
    revision,
  } = current;
  return {
    room: {
      ...snapshot,
      trackId,
      trackRevision,
      position,
      startedAt,
      playbackState,
      revision,
    },
    fullRevision: snapshot.revision,
  };
}

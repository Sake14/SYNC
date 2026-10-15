export type Timeline = {
  playbackState: "paused" | "playing";
  position: number;
  startedAt: number | null;
};

/** Pure authoritative timeline; a future anchor holds position until the shared start. */
export class SyncEngine {
  positionAt(
    state: Timeline,
    serverNowMs: number,
    duration = Number.MAX_SAFE_INTEGER / 1000,
  ): number {
    const elapsed =
      state.playbackState === "playing" && state.startedAt !== null
        ? Math.max(0, serverNowMs - state.startedAt) / 1000
        : 0;
    return Math.max(0, Math.min(duration, state.position + elapsed));
  }
  schedule(
    state: Timeline,
    now: number,
    leadMs: number,
    duration = Number.MAX_SAFE_INTEGER / 1000,
  ) {
    const position = this.positionAt(state, now, duration);
    return {
      position: position >= duration ? 0 : position,
      startedAt: now + leadMs,
      playbackState: "playing" as const,
    };
  }
  hasStarted(state: Timeline, now: number) {
    return (
      state.playbackState === "playing" &&
      state.startedAt !== null &&
      now >= state.startedAt
    );
  }
}

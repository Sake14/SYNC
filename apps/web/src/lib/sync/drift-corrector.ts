export type Correction = {
  kind: "none" | "rate" | "seek";
  rate: number;
  position: number;
  driftSeconds: number;
};

/** Error is the timeline position, never an acoustic speaker-output measurement. */
export class DriftCorrector {
  constructor(
    readonly deadband = 0.04,
    readonly seekThreshold = 0.6,
    readonly maxRateDelta = 0.01,
  ) {}
  correct(
    actual: number,
    expected: number,
    currentRate = 1,
    force = false,
  ): Correction {
    const driftSeconds = actual - expected;
    if (force || Math.abs(driftSeconds) >= this.seekThreshold)
      return { kind: "seek", rate: 1, position: expected, driftSeconds };
    if (Math.abs(driftSeconds) <= this.deadband)
      return { kind: "none", rate: 1, position: actual, driftSeconds };
    // Native output keeps normal speed; larger errors still use an anchor seek.
    if (this.maxRateDelta === 0)
      return { kind: "none", rate: 1, position: actual, driftSeconds };
    const delta = Math.max(
      -this.maxRateDelta,
      Math.min(this.maxRateDelta, -driftSeconds * 0.1),
    );
    // Ignore sub-per-mille clock noise instead of continually retuning audio.
    const target = 1 + Math.round(delta * 1000) / 1000;
    const rate = Number(
      Math.max(
        1 - this.maxRateDelta,
        Math.min(
          1 + this.maxRateDelta,
          currentRate + Math.max(-0.002, Math.min(0.002, target - currentRate)),
        ),
      ).toFixed(3),
    );
    return { kind: "rate", rate, position: actual, driftSeconds };
  }
}

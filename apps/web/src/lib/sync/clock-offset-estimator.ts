export type ClockSample = {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  monoSent: number;
  monoReceived: number;
};
export type ClockEstimate = {
  offsetMs: number;
  rttMs: number;
  samples: number;
  serverTime: number;
  localTime: number;
};

/** NTP-like estimator, with bounded fresh samples and a monotonic projection. */
export class ClockOffsetEstimator {
  private samples: (ClockSample & { rtt: number; offset: number })[] = [];
  reset() {
    this.samples = [];
  }
  add(sample: ClockSample): boolean {
    const { t0, t1, t2, t3, monoSent, monoReceived } = sample;
    if (
      ![t0, t1, t2, t3, monoSent, monoReceived].every(Number.isFinite) ||
      t2 < t1 ||
      t3 < t0 ||
      monoReceived < monoSent
    )
      return false;
    const last = this.samples.at(-1);
    if (
      last &&
      Math.abs(t3 - last.t3 - (monoReceived - last.monoReceived)) > 100
    )
      this.reset();
    if (Math.abs(t3 - t0 - (monoReceived - monoSent)) > 25) {
      this.reset();
      return false;
    }
    const rtt = t3 - t0 - (t2 - t1);
    if (rtt < 0 || rtt > 2000) return false;
    this.samples = this.samples
      .filter((s) => monoReceived - s.monoReceived <= 30_000)
      .slice(-15);
    this.samples.push({ ...sample, rtt, offset: (t1 - t0 + t2 - t3) / 2 });
    return true;
  }
  estimate(monoNow: number): ClockEstimate | null {
    const fresh = this.samples.filter(
      (s) => monoNow - s.monoReceived <= 30_000,
    );
    const last = fresh.at(-1);
    if (!last || monoNow - last.monoReceived >= 15_000 || fresh.length < 3)
      return null;
    const best = Math.min(...fresh.map((s) => s.rtt));
    const selected = fresh.filter(
      (s) => s.rtt <= best + Math.max(5, best * 0.25),
    );
    const weight = (rtt: number) => 1 / (1 + rtt) ** 2;
    const offsetMs =
      selected.reduce((sum, s) => sum + s.offset * weight(s.rtt), 0) /
      selected.reduce((sum, s) => sum + weight(s.rtt), 0);
    return {
      offsetMs,
      rttMs: best,
      samples: fresh.length,
      serverTime: last.t3 + offsetMs,
      localTime: last.monoReceived,
    };
  }
  serverNow(monoNow: number) {
    const estimate = this.estimate(monoNow);
    return estimate ? estimate.serverTime + monoNow - estimate.localTime : null;
  }
}

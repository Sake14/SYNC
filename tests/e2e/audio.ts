import type { Page } from "@playwright/test";

export function referenceWav() {
  // Original continuous tone: no samples, intentional discontinuities or clipping.
  const sampleRate = 44100, frames = 24 * sampleRate;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, i / (sampleRate * 0.05), (frames - i) / (sampleRate * 0.05));
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.4 * fade * 32767), 44 + i * 2);
  }
  return wav;
}

export async function readAudioSnapshot(page: Page) {
  return page.locator("audio").evaluate((audio: HTMLAudioElement) => ({
    paused: audio.paused,
    time: audio.currentTime,
    duration: audio.duration,
    volume: audio.volume,
    muted: audio.muted,
    src: audio.currentSrc,
    rate: audio.playbackRate,
    readyState: audio.readyState,
    networkState: audio.networkState,
    error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
    buffered: Array.from({ length: audio.buffered.length }, (_, i) => [audio.buffered.start(i), audio.buffered.end(i)]),
    // Native high-resolution time is unchanged by the Date.now skew fixture.
    sampledAt: performance.timeOrigin + performance.now(),
  }));
}

// Compare media positions at one instant, excluding time spent reading two pages.
// These test browsers share one host clock; this does not measure speaker latency.
export async function audioPositionDifference(first: Page, second: Page) {
  const samples = await Promise.all([readAudioSnapshot(first), readAudioSnapshot(second)]);
  const instant = Math.max(...samples.map(sample => sample.sampledAt));
  const positions = samples.map(sample =>
    sample.time + (sample.paused ? 0 : (instant - sample.sampledAt) * sample.rate / 1000),
  );
  return Math.abs(positions[0]! - positions[1]!);
}

export async function injectAudioDrift(page: Page, desiredSeconds: number) {
  await page.locator("audio").evaluate((audio: HTMLAudioElement, desired) => {
    const estimatedMs = Number.parseFloat(
      document.querySelector('[data-testid="sync-drift"]')?.textContent ?? "",
    );
    if (!Number.isFinite(estimatedMs)) throw new Error("A measured drift is required");
    // Correct for the existing drift so the rate/seek fixture starts on the intended side.
    audio.currentTime += desired - estimatedMs / 1000;
  }, desiredSeconds);
}

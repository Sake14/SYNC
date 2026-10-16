import { expect, test } from "@playwright/test";
import { pauseRoom } from "./actions.js";
import { injectAudioDrift, readAudioSnapshot, referenceWav } from "./audio.js";

type AudioDiagnostic = {
  rates: { at: number; rate: number }[];
  seeks: number;
  emptied: number;
};
type DiagnosticWindow = Window & { audioDiagnostic: AudioDiagnostic };

test("uploaded audio stays intact and sync corrects drift without bursts of speed changes or repeated seeks", async ({ page, context }) => {
  await page.addInitScript(() => {
    const observed = window as unknown as DiagnosticWindow;
    observed.audioDiagnostic = { rates: [], seeks: 0, emptied: 0 };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate")!;
    Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
      ...descriptor,
      set(this: HTMLMediaElement, rate: number) {
        if (this instanceof HTMLAudioElement)
          observed.audioDiagnostic.rates.push({ at: performance.now(), rate });
        descriptor.set!.call(this, rate);
      },
    });
    for (const name of ["seeking", "emptied"] as const)
      document.addEventListener(name, event => {
        if (event.target instanceof HTMLAudioElement)
          observed.audioDiagnostic[name === "seeking" ? "seeks" : "emptied"]++;
      }, true);
  });
  await page.goto("/create?track=orbit");
  await page.getByLabel("Ваше имя").fill("Audio quality");
  await page.getByRole("button", { name: "Создать комнату", exact: true }).click();
  await page.waitForURL("**/room/**");
  const wav = referenceWav();
  await page.getByLabel("Аудиофайл", { exact: true }).setInputFiles({ name: "reference.wav", mimeType: "audio/wav", buffer: wav });
  await page.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать трек reference", exact: true }).click();
  await page.goto("/sync-lab");
  await page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({ timeout: 10_000 });
  const src = (await readAudioSnapshot(page)).src;
  const downloaded = await context.request.get(src);
  expect(downloaded.status()).toBe(200);
  expect((await downloaded.body()).equals(wav)).toBe(true);
  expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.preservesPitch)).toBe(false);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await readAudioSnapshot(page)).time).toBeGreaterThan(0.5);

  // Cause genuine timeline drift in the native element, without mocking playback.
  await injectAudioDrift(page, 0.4);
  await expect.poll(async () => (await readAudioSnapshot(page)).rate).toBeLessThan(1);
  await page.waitForTimeout(300); // Exclude the seek that deliberately injected drift.
  await page.evaluate(() => {
    (window as unknown as DiagnosticWindow).audioDiagnostic = { rates: [], seeks: 0, emptied: 0 };
  });
  const before = await readAudioSnapshot(page);
  await page.waitForTimeout(2200);
  const after = await readAudioSnapshot(page);
  const diagnostic = await page.evaluate(() => (window as unknown as DiagnosticWindow).audioDiagnostic);
  expect(after.paused).toBe(false);
  expect(after.time - before.time).toBeGreaterThan(2);
  expect(after.rate).toBeGreaterThanOrEqual(0.99);
  expect(after.rate).toBeLessThanOrEqual(1.01);
  expect(diagnostic.seeks).toBe(0);
  expect(diagnostic.emptied).toBe(0);
  expect(diagnostic.rates.length).toBeLessThanOrEqual(13);
  for (const { rate } of diagnostic.rates) {
    expect(rate).toBeGreaterThanOrEqual(0.99);
    expect(rate).toBeLessThanOrEqual(1.01);
  }
  for (let i = 1; i < diagnostic.rates.length; i++)
    expect(diagnostic.rates[i]!.at - diagnostic.rates[i - 1]!.at).toBeGreaterThan(150);
  await pauseRoom(page);
  await expect.poll(async () => (await readAudioSnapshot(page)).rate).toBe(1);
  expect((await readAudioSnapshot(page)).paused).toBe(true);
});

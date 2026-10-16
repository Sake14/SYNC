import { test, expect, type Page } from "@playwright/test";
import { readAudioSnapshot, audioPositionDifference, referenceWav } from "./audio";
import { RoomWire, matchingPlayback } from "./room-wire";
import { roomAction, pauseRoom, transferHost } from "./actions";

async function create(page: Page) {
  await page.goto("/create?track=orbit");
  await page.getByLabel("Ваше имя").fill("HOST");
  await page.getByRole("button", { name: "Создать комнату", exact: true }).click();
  await page.waitForURL("**/room/**");
  await expect(page.getByLabel("Ссылка приглашения")).toHaveValue(/\/join\/[A-Za-z0-9_-]{12}$/);
  return page.getByLabel("Ссылка приглашения").inputValue();
}
async function join(page: Page, invitation: string, name: string) {
  await page.goto(invitation);
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Присоединиться", exact: true }).click();
  await page.waitForURL("**/room/**");
}
async function ready(page: Page) {
  // A real phone gesture happens in the foreground. Three independent tabs
  // otherwise leave the first Firefox tab behind the most recently opened one.
  await page.bringToFront();
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    const events: unknown[] = [];
    const record = (name: string, trusted?: boolean) => {
      events.push({ name, trusted, at: performance.now(), time: audio.currentTime, paused: audio.paused,
        readyState: audio.readyState, error: audio.error?.message, src: audio.currentSrc });
      audio.dataset.activationEvents = JSON.stringify(events);
    };
    for (const event of ["play", "playing", "pause", "abort", "emptied", "error", "loadedmetadata", "loadeddata"])
      audio.addEventListener(event, () => record(event));
    audio.closest(".player-panel")?.addEventListener("click", e => record("click", e.isTrusted), { once: true });
    record("before gesture");
  });
  await page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true }).click();
  try {
    await expect(page.locator(".audio-readiness strong")).toHaveText("Готов слушать", { timeout: 20_000 });
  } catch (error) {
    await test.info().attach("native-audio-activation", { body: JSON.stringify({
      native: await readAudioSnapshot(page),
      events: await page.locator("audio").getAttribute("data-activation-events"),
      readiness: await page.locator(".audio-readiness").innerText(),
      alerts: await page.locator(".error-notice[role=alert]").allTextContents(),
    }), contentType: "application/json" });
    throw error;
  }
}
async function automaticReady(page: Page) {
  await expect(page.locator(".audio-readiness strong")).toHaveText("Готов слушать", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true })).toHaveCount(0);
}
async function play(host: Page, clients: Page[]) {
  await expect(host.getByRole("button", { name: "Play", exact: true })).toBeEnabled({ timeout: 20_000 });
  await roomAction(host,
    () => host.getByRole("button", { name: "Play", exact: true }).click(),
    () => expect(host.getByRole("button", { name: "Pause", exact: true })).toBeVisible());
  for (const client of clients) {
    await expect.poll(async () => (await readAudioSnapshot(client)).paused).toBe(false);
    await expect.poll(async () => (await readAudioSnapshot(client)).time).toBeGreaterThan(0.2);
    const native = await readAudioSnapshot(client);
    expect(native.muted).toBe(false);
    expect(native.volume).toBeGreaterThan(0);
  }
}

test("same activated audio element survives end, private upload and track changes; peer can pause, transfer HOST and kick", async ({ page: host, browser }) => {
  test.setTimeout(90_000);
  const use = test.info().project.use;
  const options = { baseURL: use.baseURL, viewport: use.viewport, isMobile: use.isMobile,
    hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent };
  const context = await browser.newContext(options);
  const thirdContext = await browser.newContext(options);
  const peer = await context.newPage(), third = await thirdContext.newPage();
  const hostWire = new RoomWire(), peerWire = new RoomWire();
  await hostWire.attach(host); await peerWire.attach(peer);
  const errors: string[] = [];
  for (const client of [host, peer, third]) client.on("pageerror", e => errors.push(e.message));
  try {
    const invitation = await create(host);
    await join(peer, invitation, "Peer");
    await join(third, invitation, "Third");
    await expect(host.locator(".participant-list li")).toHaveCount(3);
    for (const client of [host, peer, third]) {
      expect((await readAudioSnapshot(client)).paused).toBe(true);
      await ready(client);
      await client.locator("audio").evaluate(element => { element.dataset.identity = "original-element"; });
    }
    await play(host, [host, peer, third]);
    await expect.poll(() => audioPositionDifference(host, peer)).toBeLessThan(0.8);
    // A real member PAUSE updates all clients while Play/Seek remain HOST-only.
    await roomAction(peer,
      () => peer.getByRole("button", { name: "Pause", exact: true }).click(),
      () => expect(peer.getByRole("button", { name: "Play", exact: true })).toBeVisible());
    await matchingPlayback(hostWire, peerWire, s => s.playbackState === "paused");
    for (const client of [host, peer, third]) await expect.poll(async () => (await readAudioSnapshot(client)).paused).toBe(true);
    const slider = host.getByRole("slider", { name: "Позиция трека" });
    await roomAction(host, async () => {
      await slider.fill("23.5"); await slider.dispatchEvent("pointerup");
    }, () => expect.poll(async () => (await readAudioSnapshot(peer)).time).toBeGreaterThan(23.3));
    await play(host, []);
    await expect(host.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect(peer.getByTestId("position")).toHaveText("0:24");
    await play(host, [host, peer, third]);
    await expect.poll(async () => (await readAudioSnapshot(peer)).time).toBeLessThan(5);
    await pauseRoom(host);

    // Upload real PCM bytes, rather than replacing media with mocked play().
    await host.getByLabel("Аудиофайл", { exact: true }).setInputFiles("media/orbit.wav");
    await host.getByLabel("Название композиции", { exact: true }).fill("Second recording");
    await host.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
    await expect(host.getByText("Аудио добавлено в библиотеку комнаты", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: "Выбрать трек Second recording", exact: true }).click();
    for (const client of [host, peer, third]) {
      await expect(client.getByRole("heading", { name: "Second recording", exact: true })).toBeVisible();
      await automaticReady(client);
      await expect(client.locator("audio")).toHaveAttribute("data-identity", "original-element");
    }
    // A lost media cookie must refresh authorization, not reload the same 401 endlessly.
    await context.clearCookies();
    await peer.locator("audio").evaluate((audio: HTMLAudioElement) => audio.load());
    await expect(peer.locator(".player-panel [role=alert]")).toBeVisible();
    await peer.getByRole("button", { name: "Повторить загрузку аудио", exact: true }).click();
    await automaticReady(peer);
    await expect(peer.locator(".player-panel [role=alert]")).toHaveCount(0);
    await play(host, [host, peer, third]);
    await pauseRoom(host);
    await roomAction(host,
      () => host.getByRole("button", { name: "Выбрать трек Night drive", exact: true }).click(),
      () => expect(peer.getByRole("heading", { name: "Night drive", exact: true })).toBeVisible());
    for (const client of [host, peer, third]) await automaticReady(client);
    await play(host, [host, peer, third]);
    await pauseRoom(host);

    await transferHost(host, peer, "Peer");
    await expect(peer.getByRole("slider", { name: "Позиция трека" })).toBeEnabled();
    await expect(host.getByRole("slider", { name: "Позиция трека" })).toBeDisabled();
    await roomAction(peer,
      () => peer.getByRole("button", { name: "Исключить Third", exact: true }).click(),
      () => expect(third.locator(".error-notice[role=alert]")).toContainText("HOST исключил вас из комнаты"));
    await expect(host.locator(".participant-list li")).toHaveCount(2);
    await third.reload();
    await expect(third.getByRole("button", { name: "Присоединиться", exact: true })).toBeVisible();
    // Exercise the first gesture immediately after a delayed catalog/resume.
    // The audio controller must be installed before this button accepts input.
    await peer.route("**/api/catalog", async route => { await new Promise(resolve => setTimeout(resolve, 300)); await route.continue(); });
    for (let attempt = 0; attempt < 3; attempt++) {
      await peer.reload();
      await expect(peer.getByRole("button", { name: "Включить звук / Готов слушать", exact: true })).toBeEnabled();
      expect((await readAudioSnapshot(peer)).paused).toBe(true);
      await ready(peer);
    }
    await peer.unroute("**/api/catalog");
    expect(errors).toEqual([]);
  } finally { await context.close(); await thirdContext.close(); }
});

test("failed media recovers, green theme persists and clipboard failure offers a usable selected link", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/media/orbit.wav", route => route.fulfill({ status: 503, body: "Media temporarily unavailable" }));
  await create(page);
  // Preload is a hint: some browsers only request audio after a user gesture.
  await page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true }).click();
  await expect(page.locator(".player-panel [role=alert]")).toBeVisible();
  await page.unroute("**/media/orbit.wav");
  await page.getByRole("button", { name: "Повторить загрузку аудио", exact: true }).click();
  await expect(page.locator(".audio-readiness strong")).toHaveText("Готов слушать", { timeout: 20_000 });
  await play(page, [page]);
  await pauseRoom(page);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("green");
  await page.getByRole("button", { name: "Переключить тему", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "violet");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "violet");
  await page.getByRole("button", { name: "Переключить тему", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "green");
  // Exercise the honest manual fallback when both browser clipboard APIs refuse.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("Denied")) } });
    document.execCommand = () => false;
  });
  await page.getByRole("button", { name: "Копировать ссылку", exact: true }).click();
  await expect(page.locator(".invite-panel [role=status]")).toContainText("Ссылка выделена");
  const selection = await page.getByLabel("Ссылка приглашения").evaluate((input: HTMLInputElement) => ({ start: input.selectionStart, end: input.selectionEnd, length: input.value.length }));
  expect(selection.start).toBe(0); expect(selection.end).toBe(selection.length);
  for (const width of [360, 393, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize(test.info().project.use.viewport ?? { width: 1440, height: 1000 });
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); scrollTo({ top: 0, behavior: "instant" }); });
  await page.screenshot({ path: test.info().outputPath("audio-recovery.png"), fullPage: true });
});

test("activation starts before preload finishes, but an autoplay refusal on the next track requires a gesture", async ({ page }) => {
  test.setTimeout(60_000);
  let release!: () => void;
  const pendingMedia = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/media/orbit.wav", async route => { await pendingMedia; await route.continue(); });
  try {
    await create(page);
    expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeLessThan(2);
    const enable = page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true });
    await expect(enable).toBeEnabled();
    await enable.click();
    await expect(page.getByRole("button", { name: "Подготавливаем звук…", exact: true })).toBeDisabled();
    release();
    await expect(page.locator(".audio-readiness strong")).toHaveText("Готов слушать", { timeout: 20_000 });
    // Only the permission refusal is injected; the element, network and retry play stay native.
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
      const nativePlay = audio.play;
      audio.play = function () { this.play = nativePlay; return Promise.reject(new DOMException("Autoplay denied", "NotAllowedError")); };
    });
    await page.getByRole("button", { name: "Выбрать трек Night drive", exact: true }).click();
    await expect(page.locator(".player-panel [role=alert]")).toContainText("Разрешите звук");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    await ready(page);
    await play(page, [page]);
  } finally { release(); }
});

test("Ready restores audible output before native play; local recovery does not change the room timeline", async ({ page }) => {
  const wire = new RoomWire();
  await wire.attach(page);
  await create(page);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    const nativePlay = audio.play;
    const observations: { muted: boolean; volume: number; session?: string }[] = [];
    audio.play = function () {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      observations.push({ muted: this.muted, volume: this.volume, session: session?.type });
      this.dataset.playOutputs = JSON.stringify(observations);
      return nativePlay.call(this); // The network, decoder and gesture remain real.
    };
  });
  await page.getByRole("button", { name: "Выключить звук", exact: true }).click();
  await ready(page);
  const observations = JSON.parse((await page.locator("audio").getAttribute("data-play-outputs"))!);
  expect(observations[0].muted).toBe(false);
  expect(observations[0].volume).toBeGreaterThan(0);
  if (observations[0].session) expect(observations[0].session).toBe("playback");
  await play(page, [page]);
  await page.getByText("Звук не слышно?", { exact: true }).click();
  await page.getByRole("button", { name: "Выключить звук", exact: true }).click();
  await expect.poll(async () => (await readAudioSnapshot(page)).muted).toBe(true);
  const before = await readAudioSnapshot(page);
  const anchor = [...wire.playback.values()].at(-1)!;
  await page.getByRole("button", { name: "Восстановить звук", exact: true }).click();
  await expect.poll(async () => (await readAudioSnapshot(page)).muted).toBe(false);
  await expect.poll(async () => (await readAudioSnapshot(page)).paused).toBe(false);
  await expect.poll(async () => (await readAudioSnapshot(page)).time).toBeGreaterThan(before.time);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const recoveredAnchor = [...wire.playback.values()].at(-1)!;
  expect([recoveredAnchor.trackId, recoveredAnchor.position, recoveredAnchor.startedAt, recoveredAnchor.playbackState])
    .toEqual([anchor.trackId, anchor.position, anchor.startedAt, anchor.playbackState]);
  await expect(page.getByTestId("native-audio-status")).toContainText("mute нет");
  await pauseRoom(page);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/media/night-drive.wav", async route => { await blocked; await route.continue(); });
  try {
    await roomAction(page,
      () => page.getByRole("button", { name: "Выбрать трек Night drive", exact: true }).click(),
      () => expect(page.getByRole("heading", { name: "Night drive", exact: true })).toBeVisible());
    await expect.poll(async () => (await readAudioSnapshot(page)).muted).toBe(true);
    // Cancel a still-muted preparation by selecting another real source.
    await roomAction(page,
      () => page.getByRole("button", { name: "Выбрать трек Soft focus", exact: true }).click(),
      () => expect(page.getByRole("heading", { name: "Soft focus", exact: true })).toBeVisible());
    await automaticReady(page);
    await play(page, [page]);
    await pauseRoom(page);
  } finally { release(); await page.unroute("**/media/night-drive.wav"); }
  await roomAction(page,
    () => page.getByRole("button", { name: "Выбрать трек Night drive", exact: true }).click(),
    () => expect(page.getByRole("heading", { name: "Night drive", exact: true })).toBeVisible());
  await automaticReady(page);
  await play(page, [page]);
});

test("two native audio decoders play an uploaded continuous recording without a repeated seek/pause loop", async ({ page: host, browser, context }) => {
  test.setTimeout(60_000);
  const use = test.info().project.use;
  const peerContext = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport,
    isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  try {
    const invitation = await create(host);
    const wav = referenceWav();
    await host.getByLabel("Аудиофайл", { exact: true }).setInputFiles({ name: "continuous.wav", mimeType: "audio/wav", buffer: wav });
    await host.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
    await expect(host.getByText("Аудио добавлено в библиотеку комнаты", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: "Выбрать трек continuous", exact: true }).click();
    await expect(host.getByRole("heading", { name: "continuous", exact: true })).toBeVisible();
    const peer = await peerContext.newPage();
    await join(peer, invitation, "Continuous peer");
    for (const client of [host, peer]) await ready(client);
    const src = (await readAudioSnapshot(host)).src;
    const bytes = await context.request.get(src);
    expect(bytes.status()).toBe(200); expect((await bytes.body()).equals(wav)).toBe(true);
    for (const client of [host, peer]) await client.locator("audio").evaluate((audio: HTMLAudioElement) => {
      audio.dataset.steadySeeks = "0"; audio.dataset.steadyPauses = "0";
      const session = (navigator as Navigator & { audioSession?: EventTarget & { state?: string } }).audioSession;
      const events: { event: string; at: number; time: number; paused: boolean; session?: string }[] = [];
      const record = (event: string) => {
        events.push({ event, at: performance.now(), time: audio.currentTime, paused: audio.paused, session: session?.state });
        audio.dataset.continuousEvents = JSON.stringify(events);
      };
      for (const event of ["play", "playing", "pause", "waiting", "stalled", "seeking", "seeked"])
        audio.addEventListener(event, () => record(event));
      session?.addEventListener("statechange", () => record("audio-session-state"));
      record("observe");
      audio.addEventListener("seeking", () => { audio.dataset.steadySeeks = String(Number(audio.dataset.steadySeeks) + 1); });
      audio.addEventListener("pause", () => { audio.dataset.steadyPauses = String(Number(audio.dataset.steadyPauses) + 1); });
    });
    await host.bringToFront();
    await play(host, [host, peer]);
    const before = await Promise.all([host, peer].map(readAudioSnapshot));
    await host.waitForTimeout(10_000);
    for (const [i, client] of [host, peer].entries()) {
      const after = await readAudioSnapshot(client);
      await test.info().attach(`continuous-audio-${i}`, {
        body: await client.locator("audio").getAttribute("data-continuous-events") ?? "[]",
        contentType: "application/json",
      });
      expect(after.time - before[i]!.time).toBeGreaterThan(9);
      expect(after.paused).toBe(false); expect(after.muted).toBe(false);
      // One settling correction is acceptable; chasing the cursor every
      // second, as the old WebKit path did, interrupts the decoder repeatedly.
      expect(Number(await client.locator("audio").getAttribute("data-steady-seeks"))).toBeLessThanOrEqual(1);
      expect(Number(await client.locator("audio").getAttribute("data-steady-pauses"))).toBe(0);
    }
    expect(await audioPositionDifference(host, peer)).toBeLessThan(1.2);
    await pauseRoom(host);
    for (const client of [host, peer]) await expect.poll(async () => (await readAudioSnapshot(client)).paused).toBe(true);
  } finally { await peerContext.close(); }
});

test("OS-managed volume is not rewritten during playback; Apple output keeps native speed", async ({ page }) => {
  await create(page);
  const initialVolume = await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    const volume = audio.volume;
    audio.dataset.volumeWrites = "0";
    // Mock only OS ownership on this element. WebKit platforms can expose
    // different prototype descriptors; play(), time and decoder stay native.
    Object.defineProperty(audio, "volume", { configurable: true,
      get: () => volume,
      set: () => { audio.dataset.volumeWrites = String(Number(audio.dataset.volumeWrites) + 1); },
    });
    return volume;
  });
  // Request a different value so the UI measures the now-refused capability.
  const volumeSlider = page.getByRole("slider", { name: "Громкость", exact: true });
  if (await volumeSlider.isEnabled()) await volumeSlider.fill(initialVolume > 0.5 ? "0.4" : "0.8");
  await ready(page);
  await expect.poll(async () => Number(await page.locator("audio").getAttribute("data-volume-writes"))).toBeGreaterThan(0);
  await expect(page.getByRole("slider", { name: "Громкость", exact: true })).toBeDisabled();
  await play(page, [page]);
  const writes = await page.locator("audio").getAttribute("data-volume-writes");
  // Measure steady decoder progress after startup, rather than counting the
  // output startup latency as a change of playback speed.
  await expect.poll(async () => (await readAudioSnapshot(page)).time).toBeGreaterThan(2);
  const before = await readAudioSnapshot(page);
  await page.waitForTimeout(2200); // Observe beyond the decoder settling window.
  await expect(page.locator("audio")).toHaveAttribute("data-volume-writes", writes!);
  const after = await readAudioSnapshot(page);
  expect(after.paused).toBe(false); expect(after.time - before.time).toBeGreaterThan(1.8);
  if (test.info().project.name.includes("webkit")) {
    expect(after.rate).toBe(1);
    expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.preservesPitch)).toBe(true);
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime -= 0.2; });
    await page.waitForTimeout(500);
    expect((await readAudioSnapshot(page)).rate).toBe(1);
    await expect(page.getByTestId("native-audio-status")).toContainText("режим native");
  }
  await pauseRoom(page);
});

test("private media authorization finishes before the first sound gesture, and a failed connection can be retried", async ({ page: host, browser }) => {
  test.setTimeout(90_000);
  const use = test.info().project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport,
    isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  const peer = await context.newPage();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let refuse = true;
  await peer.route("**/api/rooms/*/session", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await gate;
    if (refuse) await route.fulfill({ status: 503, body: "Session temporarily unavailable" });
    else await route.continue();
  });
  try {
    const invitation = await create(host);
    await host.getByLabel("Аудиофайл", { exact: true }).setInputFiles("media/orbit.wav");
    await host.getByLabel("Название композиции", { exact: true }).fill("Private recording");
    await host.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
    await roomAction(host,
      () => host.getByRole("button", { name: "Выбрать трек Private recording", exact: true }).click(),
      () => expect(host.getByRole("heading", { name: "Private recording", exact: true })).toBeVisible());
    await join(peer, invitation, "Peer");
    const enable = peer.getByRole("button", { name: "Включить звук / Готов слушать", exact: true });
    await expect(enable).toBeDisabled();
    await expect(peer.locator(".audio-readiness strong")).toHaveText("Подключаем музыку комнаты");
    expect((await readAudioSnapshot(peer)).paused).toBe(true);
    release();
    await expect(peer.locator(".player-panel [role=alert]")).toContainText("Не удалось подключить музыку комнаты");
    await expect(enable).toBeDisabled();
    refuse = false;
    await peer.getByRole("button", { name: "Повторить подключение музыки", exact: true }).click();
    await expect(enable).toBeEnabled();
    await ready(peer);
    await expect(peer.locator(".player-panel [role=alert]")).toHaveCount(0);
    await ready(host);
    await play(host, [host, peer]);
    await pauseRoom(host);
  } finally { release(); await context.close(); }
});

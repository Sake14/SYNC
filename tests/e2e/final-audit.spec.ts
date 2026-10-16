import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import jsQR from "jsqr";
import { audioPositionDifference, readAudioSnapshot } from "./audio.js";
import { matchingPlayback, matchingRoom, RoomWire } from "./room-wire.js";
import { pauseRoom, roomAction } from "./actions.js";

async function activate(page: Page) {
  const button = page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true });
  await expect(button).toBeEnabled();
  await button.click(); // Real user gesture; no autoplay bypass flags or mocked audio.
  await expect(page.getByRole("region", { name: "Музыкальный плеер" }).getByText("Готов слушать", { exact: true })).toBeVisible({ timeout: 10_000 });
}

test("final audit: two independent contexts share uploaded audio, QR, timeline, queue and recovered session", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const use = test.info().project.use;
  const options = {
    baseURL: use.baseURL, viewport: use.viewport, userAgent: use.userAgent,
    isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor,
  };
  const hostContext = await browser.newContext(options);
  const peerContext = await browser.newContext(options);
  const host = await hostContext.newPage();
  const peer = await peerContext.newPage();
  const hostWire = new RoomWire(), peerWire = new RoomWire();
  const errors: string[] = [];
  for (const page of [host, peer]) page.on("pageerror", error => errors.push(error.message));
  await hostWire.attach(host);
  await peerWire.attach(peer);
  try {
    await test.step("Create, decode the rendered QR and join as another listener", async () => {
      await host.goto("/create?track=orbit");
      await host.getByLabel("Ваше имя").fill("Audit HOST");
      await host.getByLabel("Название комнаты").fill("Финальный аудит SYNC");
      await host.getByRole("button", { name: "Создать комнату", exact: true }).click();
      await host.waitForURL("**/room/**");
      await host.getByRole("button", { name: "Показать QR-код" }).click();
      const invitation = await host.getByLabel("Ссылка приглашения").inputValue();
      const image = host.getByRole("img", { name: "QR-код приглашения в комнату" });
      await expect(image).toBeVisible();
      const pixels = await image.evaluate(async (element: HTMLImageElement) => {
        await element.decode();
        const canvas = document.createElement("canvas");
        canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(element, 0, 0);
        return { width: canvas.width, height: canvas.height, data: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data] };
      });
      expect(jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height)?.data).toBe(invitation);
      expect(new URL(invitation).origin).toBe(new URL(host.url()).origin);
      await peer.goto(invitation);
      await peer.getByLabel("Ваше имя").fill("Audit listener");
      await peer.getByRole("button", { name: "Присоединиться", exact: true }).click();
      await peer.waitForURL("**/room/**");
      await expect(host.locator(".participant-list li")).toHaveCount(2);
      await expect(peer.locator(".participant-list li")).toHaveCount(2);
    });

    const identities = await Promise.all([host, peer].map(page => page.evaluate(() => {
      const membership = JSON.parse(sessionStorage.getItem("sync-membership")!);
      // Never return the private token to assertion output.
      return { roomId: membership.roomId as string, participantId: membership.participantId as string };
    })));
    expect(identities[0]!.roomId).toBe(identities[1]!.roomId);
    expect(identities[0]!.participantId).not.toBe(identities[1]!.participantId);
    const roomId = identities[0]!.roomId;
    const room = await matchingRoom(hostWire, peerWire, room => room.id === roomId && room.participants.length === 2);
    expect(room.hostId).toBe(identities[0]!.participantId);
    expect(JSON.stringify(room)).not.toContain("resumeToken");

    const wav = await readFile("media/orbit.wav");
    await test.step("Upload one real WAV and keep anonymous access private", async () => {
      await peer.getByLabel("Аудиофайл", { exact: true }).setInputFiles({ name: "audit.wav", mimeType: "audio/wav", buffer: wav });
      await peer.getByLabel("Название композиции", { exact: true }).fill("Audit recording");
      await peer.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
      await expect(peer.getByText("Аудио добавлено в библиотеку комнаты", { exact: true })).toBeVisible();
      await expect(host.getByRole("button", { name: "Выбрать трек Audit recording", exact: true })).toBeEnabled();
      await expect(peer.getByRole("button", { name: "Выбрать трек Audit recording", exact: true })).toBeDisabled();
      await host.getByRole("button", { name: "Выбрать трек Audit recording", exact: true }).click();
      await expect(peer.getByRole("heading", { name: "Audit recording", exact: true })).toBeVisible();
      await expect(host.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
      expect((await readAudioSnapshot(host)).paused && (await readAudioSnapshot(peer)).paused).toBe(true);
      await activate(host); await activate(peer);
    });

    const uploaded = (await matchingRoom(hostWire, peerWire, room => room.id === roomId && room.library.length === 1)).library[0]!;
    expect(uploaded.streamPath).toContain("/media/room_");
    for (const context of [hostContext, peerContext]) {
      const response = await context.request.get(uploaded.streamPath, { headers: { Range: "bytes=0-43" } });
      expect(response.status()).toBe(206);
      expect(await response.body()).toEqual(wav.subarray(0, 44));
    }
    expect((await request.get(uploaded.streamPath)).status()).toBe(401);

    await test.step("Play/Pause/Seek: compare server anchors and actual media positions", async () => {
      await expect(host.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
      await host.getByRole("button", { name: "Play", exact: true }).click();
      const start = await matchingPlayback(hostWire, peerWire, state => state.roomId === roomId && state.trackId === uploaded.id && state.playbackState === "playing");
      expect(start.startedAt!).toBeGreaterThan(start.serverTime);
      await expect.poll(async () => !(await readAudioSnapshot(host)).paused && !(await readAudioSnapshot(peer)).paused).toBe(true);
      await expect.poll(async () => (await readAudioSnapshot(peer)).time).toBeGreaterThan(0.2);
      await expect.poll(() => audioPositionDifference(host, peer)).toBeLessThan(0.4);
      await pauseRoom(host);
      await matchingPlayback(hostWire, peerWire, state => state.roomId === roomId && state.revision > start.revision && state.playbackState === "paused");
      await expect.poll(async () => (await readAudioSnapshot(host)).paused && (await readAudioSnapshot(peer)).paused).toBe(true);
      await expect.poll(() => audioPositionDifference(host, peer)).toBeLessThan(0.15);
      const slider = host.getByRole("slider", { name: "Позиция трека" });
      await roomAction(host, async () => {
        await expect(host.getByRole("heading", { name: "Audit recording", exact: true })).toBeVisible();
        await expect(slider).toBeEnabled();
        await slider.evaluate(element => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, "6");
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await slider.dispatchEvent("pointerup");
      }, () => matchingPlayback(hostWire, peerWire, state => state.roomId === roomId && state.trackId === uploaded.id && state.playbackState === "paused" && state.position === 6));
      for (const page of [host, peer]) {
        await expect.poll(async () => Math.abs((await readAudioSnapshot(page)).time - 6)).toBeLessThan(0.1);
        expect((await readAudioSnapshot(page)).paused).toBe(true);
      }
    });

    await test.step("Reaction, queue ordering and HOST track change reach both browsers", async () => {
      await peer.getByRole("button", { name: "Отправить реакцию 🔥", exact: true }).click();
      for (const page of [host, peer]) await expect(page.getByTestId("reaction-feed")).toHaveText("🔥 Audit listener");
      await peer.getByRole("button", { name: "Добавить в очередь Night drive", exact: true }).click();
      await expect(host.getByRole("region", { name: "Общая очередь" }).locator("li")).toHaveCount(1);
      await host.getByRole("button", { name: "Добавить в очередь Soft focus", exact: true }).click();
      await matchingRoom(hostWire, peerWire, room => room.id === roomId && room.queue.length === 2);
      await host.getByRole("button", { name: "Выше в очереди Soft focus", exact: true }).click();
      const ordered = await matchingRoom(hostWire, peerWire, room => room.id === roomId && room.queue[0]?.trackId === "soft-focus");
      expect(ordered.queue.map(entry => entry.trackId)).toEqual(["soft-focus", "night-drive"]);
      await expect(peer.getByRole("button", { name: "Следующий трек", exact: true })).toBeDisabled();
      await host.getByRole("button", { name: "Следующий трек", exact: true }).click();
      await matchingRoom(hostWire, peerWire, room => room.id === roomId && room.trackId === "soft-focus" && room.queue.length === 1);
      for (const page of [host, peer]) {
        await expect(page.getByRole("heading", { name: "Soft focus", exact: true })).toBeVisible();
        await expect(page.locator(".audio-readiness")).toContainText("Готов слушать");
        await expect(page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true })).toHaveCount(0);
      }
      await host.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(async () => !(await readAudioSnapshot(host)).paused && !(await readAudioSnapshot(peer)).paused).toBe(true);
    });

    await test.step("Close the real transport, change state while offline, then resume the same participant", async () => {
      await peerWire.interrupt();
      await expect(peer.getByRole("region", { name: "Состояние комнаты" })).toContainText("Связь с комнатой прервалась");
      await expect.poll(async () => (await readAudioSnapshot(peer)).paused).toBe(true);
      await expect(host.locator(".participant-list li")).toHaveCount(1);
      await host.getByRole("button", { name: "Выбрать трек Orbit", exact: true }).click();
      await host.getByRole("button", { name: "Добавить в очередь Audit recording", exact: true }).click();
      peerWire.restore();
      await expect(host.locator(".participant-list li")).toHaveCount(2);
      await expect(peer.getByRole("region", { name: "Состояние комнаты" }).getByText("Связь с комнатой прервалась", { exact: false })).toHaveCount(0);
      const restored = await matchingRoom(hostWire, peerWire, room => room.id === roomId && room.trackId === "orbit" && room.participants.length === 2 && room.queue.length === 2);
      expect(restored.participants.map(participant => participant.id).sort()).toEqual(identities.map(identity => identity.participantId).sort());
      expect(restored.hostId).toBe(identities[0]!.participantId);
      expect(restored.library).toHaveLength(1);
      expect(restored.queue.map(entry => entry.trackId)).toEqual(["night-drive", uploaded.id]);
      await expect(peer.getByRole("heading", { name: "Orbit", exact: true })).toBeVisible();
      const after = await peer.evaluate(() => JSON.parse(sessionStorage.getItem("sync-membership")!).participantId);
      expect(after).toBe(identities[1]!.participantId);
      for (const page of [host, peer]) {
        await expect(page.locator(".audio-readiness")).toContainText("Готов слушать");
        await expect(page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true })).toHaveCount(0);
      }
      await host.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(async () => !(await readAudioSnapshot(host)).paused && !(await readAudioSnapshot(peer)).paused).toBe(true);
      await expect.poll(() => audioPositionDifference(host, peer)).toBeLessThan(0.4);
      await pauseRoom(host);
      await expect.poll(async () => (await readAudioSnapshot(host)).paused && (await readAudioSnapshot(peer)).paused).toBe(true);
    });

    for (const page of [host, peer]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(hostWire.invalidMessages + peerWire.invalidMessages).toBe(0);
    expect(errors).toEqual([]);
    await host.screenshot({ path: "/tmp/sync-final-audit-" + test.info().project.name + ".png", fullPage: true });
  } finally {
    peerWire.restore();
    await Promise.all([hostContext.close(), peerContext.close()]);
  }
});

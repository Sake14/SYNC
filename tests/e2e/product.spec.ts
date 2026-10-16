import { audioPositionDifference, readAudioSnapshot as state } from "./audio.js";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pauseRoom, roomAction } from "./actions.js";

async function ready(page: Page) {
  const button = page.getByRole("button", { name: "Включить звук / Готов слушать", exact: true });
  await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByRole("region", { name: "Музыкальный плеер" }).getByText("Готов слушать", { exact: true })).toBeVisible({ timeout: 10_000 });
}
async function quickRoom(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Создать комнату", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Создать комнату", exact: true }).click();
  await page.waitForURL("**/room/**");
  await expect(page.getByRole("heading", { name: "Вечер вместе" })).toBeVisible();
}

test("one-click room, invitation, both ready, actual synchronized audio, pause/seek, peer reaction, private upload and shared queue", async ({ page, browser, context }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const peerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: page.viewportSize()! });
  try {
    await quickRoom(page);
    await page.getByRole("button", { name: "Выбрать трек Orbit", exact: true }).click();
    await page.getByRole("button", { name: "Показать QR-код" }).click();
    await expect(page.getByRole("img", { name: "QR-код приглашения в комнату" })).toBeVisible();
    const invitation = await page.getByLabel("Ссылка приглашения").inputValue();
    expect(invitation).toMatch(/\/join\/[A-Za-z0-9_-]{12}$/);
    const peer = await peerContext.newPage(); peer.on("pageerror", e => errors.push(e.message));
    await peer.goto(invitation);
    await peer.getByLabel("Ваше имя").fill("Аня");
    await peer.getByRole("button", { name: "Присоединиться" }).click();
    await peer.waitForURL("**/room/**");
    await expect(page.locator(".participant-list li")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Состояние комнаты" })).toContainText("2 слушателей");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    expect((await state(page)).paused && (await state(peer)).paused).toBe(true);
    await ready(page); await ready(peer);
    await expect(page.getByRole("region", { name: "Состояние комнаты" })).toContainText("готовы 2 из 2");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => !(await state(page)).paused && !(await state(peer)).paused).toBe(true);
    await expect.poll(async () => (await state(peer)).time).toBeGreaterThan(0.2);
    await expect.poll(async () => await audioPositionDifference(page, peer)).toBeLessThan(0.4);
    const slider = page.getByRole("slider", { name: "Позиция трека" });
    await roomAction(page, async () => {
      await expect(slider).toBeEnabled();
      await slider.evaluate(element => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, "8");
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await slider.dispatchEvent("pointerup");
    }, () => expect.poll(async () => (await state(peer)).time).toBeGreaterThanOrEqual(7.8));
    await expect.poll(async () => (await state(peer)).time).toBeGreaterThanOrEqual(7.8);
    await pauseRoom(page);
    await expect.poll(async () => (await state(page)).paused && (await state(peer)).paused).toBe(true);
    await expect.poll(async () => await audioPositionDifference(page, peer)).toBeLessThan(0.15);
    await peer.getByRole("button", { name: "Отправить реакцию 🔥", exact: true }).click();
    await expect(page.getByTestId("reaction-feed")).toHaveText("🔥 Аня");
    await expect(peer.getByTestId("reaction-feed")).toHaveText("🔥 Аня");

    const wav = await readFile("media/orbit.wav");
    await peer.getByLabel("Аудиофайл", { exact: true }).setInputFiles({ name: "my-recording.wav", mimeType: "audio/wav", buffer: wav });
    await peer.getByLabel("Название композиции", { exact: true }).fill("Наша запись");
    await peer.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
    await expect(peer.getByText("Аудио добавлено в библиотеку комнаты", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Выбрать трек Наша запись", exact: true })).toBeVisible();
    await expect(peer.getByRole("button", { name: "Выбрать трек Наша запись", exact: true })).toBeDisabled();
    await peer.getByRole("button", { name: "Добавить в очередь Наша запись", exact: true }).click();
    await expect(page.getByRole("region", { name: "Общая очередь" })).toContainText("Наша запись");
    await page.getByRole("button", { name: "Добавить в очередь Night drive", exact: true }).click();
    await expect(peer.getByRole("region", { name: "Общая очередь" }).locator("li")).toHaveCount(2);
    await page.getByRole("button", { name: "Следующий трек", exact: true }).click();
    await expect(peer.getByRole("heading", { name: "Наша запись", exact: true })).toBeVisible();
    for (const client of [page, peer]) {
      await expect(client.locator(".audio-readiness")).toContainText("Готов слушать");
      await expect(client.getByRole("button", { name: "Включить звук / Готов слушать", exact: true })).toHaveCount(0);
    }
    const src = (await state(peer)).src;
    expect(src).toContain("/media/room_");
    for (const http of [context.request, peerContext.request]) {
      const response = await http.get(src, { headers: { Range: "bytes=0-43" } });
      expect(response.status()).toBe(206); expect(await response.body()).toEqual(wav.subarray(0, 44));
    }
    const anonymous = await browser.newContext();
    try { expect((await anonymous.request.get(src)).status()).toBe(401); } finally { await anonymous.close(); }
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => !(await state(page)).paused && !(await state(peer)).paused).toBe(true);
    await expect.poll(async () => (await state(peer)).time).toBeGreaterThan(0.2);
    await pauseRoom(page);
    await expect.poll(async () => (await state(page)).paused && (await state(peer)).paused).toBe(true);
    for (const client of [page, peer]) expect(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: "instant" }); });
    await page.screenshot({ path: `/tmp/sync-product-${test.info().project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await peerContext.close(); }
});

test("upload errors stay visible and a valid retry recovers without losing the room", async ({ page }) => {
  await quickRoom(page);
  await page.getByLabel("Аудиофайл", { exact: true }).setInputFiles({ name: "forged.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("This is not audio") });
  await page.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
  await expect(page.getByRole("region", { name: "Загрузка аудио" }).getByRole("alert")).toContainText("настоящие аудиофайлы");
  await page.getByLabel("Аудиофайл", { exact: true }).setInputFiles({ name: "too-large.wav", mimeType: "audio/wav", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await page.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
  await expect(page.getByRole("region", { name: "Загрузка аудио" }).getByRole("alert")).toContainText("20 МБ");
  await page.getByLabel("Аудиофайл", { exact: true }).setInputFiles("media/orbit.wav");
  await page.getByLabel("Название композиции", { exact: true }).fill("После ошибки");
  await page.getByRole("button", { name: "Загрузить в комнату", exact: true }).click();
  await expect(page.getByText("Аудио добавлено в библиотеку комнаты", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Выбрать трек После ошибки", exact: true })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("Zvuk is explicitly unsupported, offers only an official page, and Local Music remains accessible", async ({ page, request }) => {
  const errors: string[] = [], externalRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => { if (new URL(req.url()).hostname === "zvuk.com") externalRequests.push(req.url()); });
  await page.goto("/");
  await page.getByRole("link", { name: "Музыкальные сервисы и ссылки Звука" }).click();
  await page.waitForURL("**/music-services");
  const zvuk = page.getByRole("region", { name: "Звук", exact: true });
  await expect(zvuk).toContainText("API каталога не подключён.");
  await expect(zvuk).toContainText("UNSUPPORTED");
  await page.getByLabel("Ссылка или ID композиции Звука").fill("https://zvuk.com.evil.invalid/track/42");
  await page.getByRole("button", { name: "Подготовить ссылку" }).click();
  await expect(zvuk).toContainText("Введите ID трека");
  await expect(page.getByRole("link", { name: "Открыть композицию в Звуке" })).toHaveCount(0);
  await page.getByLabel("Ссылка или ID композиции Звука").fill("https://zvuk.com/track/42?utm_source=test");
  await page.getByRole("button", { name: "Подготовить ссылку" }).click();
  const link = page.getByRole("link", { name: "Открыть композицию в Звуке" });
  await expect(link).toHaveAttribute("href", "https://zvuk.com/track/42");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator("audio")).toHaveCount(0);
  const playback = await request.get("/api/music/zvuk/tracks/42/playback");
  expect(playback.status()).toBe(501);
  expect(await playback.json()).toMatchObject({ status: "UNSUPPORTED", officialUrl: "https://zvuk.com/track/42" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/sync-zvuk-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("link", { name: "Открыть локальную музыку" }).click();
  await expect(page.getByRole("link", { name: "Создать комнату с треком Orbit" })).toBeVisible();
  expect(externalRequests).toEqual([]); expect(errors).toEqual([]);
});

test("provider status/network errors are visible, retry recovers and leaves local catalog intact", async ({ page }) => {
  await page.route("**/api/music/providers", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/music-services");
  await expect(page.locator(".error-notice[role=alert]")).toContainText("Не удалось получить состояние");
  await page.unroute("**/api/music/providers");
  await page.getByRole("button", { name: "Повторить проверку сервисов" }).click();
  await expect(page.locator(".error-notice[role=alert]")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Звук", exact: true })).toContainText("UNSUPPORTED");
  await page.route("**/api/music/zvuk/tracks/*/playback", route => route.abort());
  await page.getByLabel("Ссылка или ID композиции Звука").fill("42");
  await page.getByRole("button", { name: "Подготовить ссылку" }).click();
  await expect(page.getByRole("region", { name: "Звук", exact: true })).toContainText("Не удалось получить ссылку");
  await page.unroute("**/api/music/zvuk/tracks/*/playback");
  await page.getByRole("button", { name: "Подготовить ссылку" }).click();
  await expect(page.getByRole("link", { name: "Открыть композицию в Звуке" })).toBeVisible();
});

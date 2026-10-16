import { audioPositionDifference, injectAudioDrift, readAudioSnapshot as audioState } from "./audio.js";
import { expect, test, type Page } from "@playwright/test";
import { pauseRoom, playRoom, roomAction } from "./actions.js";

async function createRoom(page: Page) {
  await page.goto("/create?track=orbit");
  await page.getByLabel("Ваше имя").fill("Кирилл");
  await page.getByLabel("Название комнаты").fill("Наш вечер");
  await page
    .getByRole("button", { name: "Создать комнату", exact: true })
    .click();
  await page.waitForURL("**/room/**");
  await expect(page.getByRole("heading", { name: "Наш вечер" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Orbit", exact: true }),
  ).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop()!;
}
async function enableAudio(page: Page) {
  const button = page.getByRole("button", {
    name: "Включить звук / Готов слушать",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page
      .getByRole("region", { name: "Музыкальный плеер" })
      .getByText("Готов слушать", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
}
async function setRange(
  page: Page,
  label: string,
  value: number,
  commit = false,
) {
  const slider = page.getByRole("slider", { name: label });
  const perform = async () => {
    await expect(slider).toBeEnabled();
    await slider.evaluate((element, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(element, String(next));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    if (commit) await slider.dispatchEvent("pointerup");
  };
  if (commit) await roomAction(page, perform, () =>
    expect.poll(async () => (await audioState(page)).time).toBeGreaterThanOrEqual(Math.max(0, value - 0.1)));
  else await perform();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("opens real local library, handles HTTP failure and has no browser errors", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.goto("/");
  await expect(page).toHaveTitle(/SYNC/);
  await expect(
    page.getByRole("heading", { name: "Один трек. Общий момент." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сервер на связи" }),
  ).toBeVisible();
  await expect(
    page.getByText("Каталог недоступен.", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/catalog");
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(
    page.getByRole("link", { name: "Создать комнату с треком Orbit" }),
  ).toBeVisible();
  const range = await request.get("/media/orbit.wav", {
    headers: { Range: "bytes=0-43" },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(44);
  expect((await request.get("/api/health")).ok()).toBe(true);
  await noOverflow(page);
  for (const width of [360, 393]) {
    await page.setViewportSize({ width, height: 851 });
    await noOverflow(page);
  }
  expect(errors).toEqual([]);
});

test("validates creation, persists name and shows a nonexistent invitation honestly", async ({
  page,
}) => {
  let releaseCatalog!: () => void;
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route("**/api/catalog", async (route) => {
    await catalogGate;
    await route.continue();
  });
  await page.goto("/create?track=orbit");
  await expect(
    page.getByRole("button", { name: "Сервер на связи" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать комнату", exact: true }),
  ).toBeDisabled();
  releaseCatalog();
  await expect(
    page.getByRole("button", { name: "Создать комнату", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Создать комнату", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Введите имя");
  await page.getByLabel("Ваше имя").fill("  Кирилл  ");
  await page
    .getByRole("button", { name: "Создать комнату", exact: true })
    .click();
  await page.waitForURL("**/room/**");
  await expect(
    page.getByRole("heading", { name: "Orbit", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL("/");
  await page.reload();
  await page.goto("/join/missingroom12");
  await expect(page.getByLabel("Ваше имя")).toHaveValue("Кирилл");
  await page.getByRole("button", { name: "Присоединиться" }).click();
  await expect(page.locator(".error-notice[role=alert]")).toHaveText(
    /Комната не найдена/,
  );
  await noOverflow(page);
});

test("two listeners hear actual audio, sync seek/pause/track, show QR and transfer HOST", async ({
  page,
  browser,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const id = await createRoom(page);
  // Explicit audio gate: no audio starts before the user's activation.
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  expect((await audioState(page)).paused).toBe(true);
  await enableAudio(page);
  await playRoom(page);
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await expect
    .poll(async () => (await audioState(page)).time)
    .toBeGreaterThan(0.2);

  const secondContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: page.viewportSize()!,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const listener = await secondContext.newPage();
  listener.on("pageerror", (error) => errors.push(error.message));
  await listener.goto(`/join/${id}`);
  await listener.getByLabel("Ваше имя").fill("Аня");
  await listener.getByRole("button", { name: "Присоединиться" }).click();
  await listener.waitForURL("**/room/**");
  await expect(page.locator(".participant-list li")).toHaveCount(2);
  await expect(
    listener.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  expect((await audioState(listener)).paused).toBe(true);
  await enableAudio(listener);
  await expect
    .poll(async () => (await audioState(listener)).paused)
    .toBe(false);
  await expect
    .poll(async () =>
      await audioPositionDifference(page, listener),
    )
    .toBeLessThan(0.8);

  await setRange(page, "Позиция трека", 10, true);
  await expect
    .poll(async () => (await audioState(listener)).time)
    .toBeGreaterThanOrEqual(9.8);
  await pauseRoom(page);
  await expect
    .poll(
      async () =>
        (await audioState(page)).paused && (await audioState(listener)).paused,
    )
    .toBe(true);
  await setRange(listener, "Громкость", 0.25);
  await expect.poll(async () => (await audioState(listener)).volume).toBe(0.25);
  expect((await audioState(page)).volume).toBe(0.7);

  await roomAction(page,
    () => page.getByRole("button", { name: "Выбрать трек Soft focus" }).click(),
    () => expect(listener.getByRole("heading", { name: "Soft focus", exact: true })).toBeVisible());
  await expect
    .poll(async () => (await audioState(listener)).src)
    .toContain("soft-focus.wav");
  await expect(listener.getByTestId("position")).toHaveText("0:00");
  // Muted source priming can advance the native decoder by a few samples.
  await expect.poll(async () => Math.abs((await audioState(listener)).time)).toBeLessThan(0.03);
  await expect.poll(async () => (await audioState(listener)).paused).toBe(true);
  for (const client of [page, listener]) {
    await expect(client.getByRole("button", { name: "Включить звук / Готов слушать", exact: true })).toHaveCount(0);
    await expect(client.locator(".audio-readiness")).toContainText("Готов слушать");
  }
  await setRange(page, "Позиция трека", 23.7, true);
  await playRoom(page);
  // The backend ends the track even without an ended command from a browser.
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await expect(listener.getByTestId("position")).toHaveText("0:24");
  await expect.poll(async () => (await audioState(listener)).paused).toBe(true);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Копировать ссылку" }).click();
  await expect(page.locator(".invite-panel [role=status]")).toHaveText(
    "Ссылка скопирована",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    `/join/${id}`,
  );
  await page.getByRole("button", { name: "Показать QR-код" }).click();
  await expect(
    page.getByRole("img", { name: "QR-код приглашения в комнату" }),
  ).toBeVisible();
  await noOverflow(page);
  await noOverflow(listener);
  await roomAction(page,
    () => page.getByRole("button", { name: "Выйти", exact: true }).click(),
    () => expect(listener.getByText("ВЫ HOST", { exact: true })).toBeVisible());
  await expect(
    listener.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
  await secondContext.close();
});

test("reload restores the same listener and the latest track, but requires audio activation again", async ({
  page,
  browser,
}) => {
  const id = await createRoom(page);
  const secondContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: page.viewportSize()!,
  });
  const listener = await secondContext.newPage();
  await listener.goto(`/join/${id}`);
  await listener.getByLabel("Ваше имя").fill("Аня");
  await listener.getByRole("button", { name: "Присоединиться" }).click();
  await listener.waitForURL("**/room/**");
  const participantBefore = await listener.evaluate(
    () => JSON.parse(sessionStorage.getItem("sync-membership")!).participantId,
  );
  const roomUrl = listener.url();
  await listener.goto("about:blank");
  await expect(page.locator(".participant-list li")).toHaveCount(1);
  await page.getByRole("button", { name: "Выбрать трек Night drive" }).click();
  await listener.goto(roomUrl);
  await expect(
    listener.getByRole("heading", { name: "Night drive", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".participant-list li")).toHaveCount(2);
  expect(
    await listener.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("sync-membership")!).participantId,
    ),
  ).toBe(participantBefore);
  await listener.reload();
  await expect(
    listener.getByRole("heading", { name: "Night drive", exact: true }),
  ).toBeVisible();
  await expect(
    listener.getByRole("button", {
      name: "Включить звук / Готов слушать",
      exact: true,
    }),
  ).toBeVisible();
  expect((await audioState(listener)).paused).toBe(true);
  await secondContext.close();
});

test("a rejected autoplay permission stays visible and the next gesture really enables audio", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let first = true;
    HTMLMediaElement.prototype.play = function () {
      if (first) {
        first = false;
        return Promise.reject(
          new DOMException("User activation required", "NotAllowedError"),
        );
      }
      return original.call(this);
    };
  });
  await createRoom(page);
  await expect(
    page.getByRole("button", {
      name: "Включить звук / Готов слушать",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Включить звук / Готов слушать", exact: true })
    .click();
  await expect(page.locator(".error-notice[role=alert]")).toHaveText(
    /Разрешите звук/,
  );
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  expect((await audioState(page)).paused).toBe(true);
  await enableAudio(page);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
});

test("scheduled audio tolerates skewed clocks and delayed/reordered messages; diagnostics report actual timeline drift", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = await createRoom(page);
  await page.goto("/sync-lab");
  await expect(
    page.getByRole("region", { name: "Диагностика синхронизации" }),
  ).toBeVisible();
  const secondContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: page.viewportSize()!,
  });
  await secondContext.addInitScript(() => {
    const nativeNow = Date.now;
    Date.now = () => nativeNow() + 9000;
  });
  const listener = await secondContext.newPage();
  listener.on("pageerror", (e) => errors.push(e.message));
  await listener.goto(`/join/${id}`);
  await listener.getByLabel("Ваше имя").fill("Аня");
  await listener.getByRole("button", { name: "Присоединиться" }).click();
  await listener.waitForURL("**/room/**");
  await listener.goto("/sync-lab");
  await enableAudio(page);
  await enableAudio(listener);
  await listener.getByLabel("Задержка сообщений").fill("250");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  // Scheduled is intentionally brief. Observe both DOMs before PLAY, rather than sequential
  // assertions whose polling/backoff can miss the listener's pre-start window under load.
  const scheduled = Promise.all([page, listener].map(client => client.evaluate(() => new Promise<boolean>(resolve => {
    const finish = (paused: boolean) => { clearTimeout(timer); observer.disconnect(); resolve(paused); };
    const read = () => {
      if (document.querySelector('[data-testid="sync-phase"]')?.textContent?.includes("scheduled"))
        finish((document.querySelector("audio") as HTMLAudioElement | null)?.paused === true);
    };
    const timer = setTimeout(() => finish(false), 5000);
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    read();
  }))));
  await playRoom(page);
  expect(await scheduled).toEqual([true, true]);
  await expect
    .poll(
      async () =>
        !(await audioState(page)).paused &&
        !(await audioState(listener)).paused,
    )
    .toBe(true);
  await expect
    .poll(async () =>
      await audioPositionDifference(page, listener),
    )
    .toBeLessThan(0.3);
  // A real media seek can stall decoding briefly; stay within the moderate tier.
  await injectAudioDrift(listener, 0.4);
  await expect
    .poll(async () =>
      Number(await listener.getByTestId("sync-rate").textContent()),
    )
    .toBeLessThan(1);
  await injectAudioDrift(listener, 1.2);
  await expect
    .poll(async () =>
      Math.abs(
        parseFloat((await listener.getByTestId("sync-drift").textContent())!),
      ),
      // Decoder recovery can leave a moderate residual, corrected at the bounded rate.
      { timeout: 10_000 },
    )
    .toBeLessThan(150);
  await listener.getByLabel("Задержка сообщений").fill("1700");
  const before = await listener.evaluate(() => performance.now());
  await pauseRoom(page);
  await roomAction(page,
    () => page.getByRole("button", { name: "Play", exact: true }).click(),
    () => expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible());
  await listener.getByLabel("Задержка сообщений").fill("0");
  await pauseRoom(page);
  await expect.poll(async () => (await audioState(listener)).paused).toBe(true);
  await expect
    .poll(async () => listener.evaluate(() => performance.now()))
    .toBeGreaterThan(before + 1900);
  expect((await audioState(listener)).paused).toBe(true);
  await expect(listener.getByTestId("sync-phase")).toHaveText(/paused/);
  await noOverflow(page);
  await noOverflow(listener);
  expect(errors).toEqual([]);
  await secondContext.close();
});

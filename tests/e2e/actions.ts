import { expect, type Page } from "@playwright/test";

/** Follow the visible retry flow; never silently replay a rejected command. */
export async function roomAction(page: Page, perform: () => Promise<void>, settled: () => Promise<unknown>) {
  const stale = page.locator(".error-notice[role=alert]").filter({ hasText: "Состояние обновилось. Попробуйте действие ещё раз." });
  for (let attempt = 0; attempt < 3; attempt++) {
    await perform();
    // A visible Play button can arrive before the private ACK. Wait for the
    // actual command/refresh to finish, as a user must before another control.
    await expect.poll(async () => {
      const exit = page.getByRole("button", { name: "Выйти", exact: true });
      return await exit.count() === 0 || await exit.isEnabled();
    }).toBe(true);
    if (await stale.isVisible()) {
      await expect(stale).toHaveText("Состояние обновилось. Попробуйте действие ещё раз.");
      continue;
    }
    await settled();
    return;
  }
  throw new Error("Room command remained stale after the advertised retry flow");
}

export function pauseRoom(page: Page) {
  return roomAction(page,
    () => page.getByRole("button", { name: "Pause", exact: true }).click(),
    () => page.getByRole("button", { name: "Play", exact: true }).waitFor({ state: "visible", timeout: 5000 }),
  );
}

export function playRoom(page: Page) {
  return roomAction(page,
    () => page.getByRole("button", { name: "Play", exact: true }).click(),
    () => expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible());
}

export async function transferHost(host: Page, peer: Page, name: string) {
  await roomAction(host,
    () => host.getByRole("button", { name: `Передать HOST ${name}`, exact: true }).click(),
    () => expect(peer.getByRole("slider", { name: "Позиция трека" })).toBeEnabled());
}

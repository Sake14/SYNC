/** Keep the visible invitation selected when clipboard APIs cannot write. */
export async function copyInvitation(text: string, input: HTMLInputElement, preferLegacy = false): Promise<"copied" | "manual"> {
  const legacy = () => {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    try { return document.execCommand("copy"); } catch { return false; }
  };
  if (preferLegacy || !window.isSecureContext || !navigator.clipboard?.writeText)
    return legacy() ? "copied" : "manual";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Clipboard did not respond")), 1500); }),
    ]);
    return "copied";
  } catch {
    return legacy() ? "copied" : "manual";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

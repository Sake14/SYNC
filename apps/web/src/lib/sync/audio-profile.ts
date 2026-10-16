/** All iOS browsers and Safari use the native Apple media output path. */
export function usesNativeAppleAudio(userAgent: string, maxTouchPoints = 0) {
  const mobileApple = /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const safari = /AppleWebKit/.test(userAgent) && /Safari/.test(userAgent) &&
    !/Chrome|Chromium|Edg|OPR|Android/.test(userAgent);
  return mobileApple || safari;
}

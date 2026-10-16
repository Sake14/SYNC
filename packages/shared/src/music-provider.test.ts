import { describe, expect, it } from "vitest";
import { zvukTrackReferenceSchema, providerTrackSchema, zvukTrackPage } from "./music-provider.js";

describe("external track boundaries", () => {
  it("canonicalizes only numeric IDs and official pages without forwarding tracking parameters", () => {
    expect(zvukTrackReferenceSchema.parse(" 42 ")).toBe("42");
    expect(zvukTrackReferenceSchema.parse("https://zvuk.com/track/42/?utm_source=test#share")).toBe("42");
    expect(zvukTrackPage("42")).toBe("https://zvuk.com/track/42");
  });
  it.each(["https://zvuk.com.evil.invalid/track/42", "https://evil.invalid/track/42", "https://name:pass@zvuk.com/track/42", "http://zvuk.com/track/42", "https://zvuk.com:444/track/42", "javascript:alert(1)", "../42", "https://zvuk.com/track/42/more", "0"])("rejects unsafe reference %s", input => {
    expect(zvukTrackReferenceSchema.safeParse(input).success).toBe(false);
  });
  it("keeps external metadata outside the local HTTP media contract", () => {
    const track = { provider: "zvuk", id: "42", title: "Test", artist: "Artist", durationSeconds: null, officialUrl: "https://zvuk.com/track/42" };
    expect(providerTrackSchema.safeParse(track).success).toBe(true);
    expect(providerTrackSchema.safeParse({ ...track, streamPath: "/media/test.mp3" }).success).toBe(false);
    expect(providerTrackSchema.safeParse({ ...track, officialUrl: "https://evil.invalid/track/42" }).success).toBe(false);
  });
});

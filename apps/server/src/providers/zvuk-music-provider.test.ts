import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { parseConfig } from "../config.js";
import { MusicCatalog } from "../catalog/catalog.js";
import { LocalMusicProvider } from "./local-music-provider.js";
import { ZvukMusicProvider, type ApprovedZvukMetadataAdapter, type ZvukMetadataApproval } from "./zvuk-music-provider.js";

// Simulated permission and normalized responses only. This is NOT a live API or real grant.
const approval: ZvukMetadataApproval = {
  documentationUrl: "https://zvuk.com/test-only-documentation", permissionReference: "TEST-ONLY-GRANT",
  validUntil: 10_000, operations: ["searchTracks", "getTrack", "getUserLibrary", "getPlaylists"], publicMetadata: true,
};
const track = { id: "42", title: "Test track", artist: "Test artist", durationSeconds: 24 };
function mock(response: Awaited<ReturnType<ApprovedZvukMetadataAdapter["request"]>> = { statusCode: 200, body: { tracks: [track] } }, permission: ZvukMetadataApproval = approval) {
  const adapter = { request: vi.fn<ApprovedZvukMetadataAdapter["request"]>().mockResolvedValue(response) };
  const provider = new ZvukMusicProvider({ integration: { approval: permission, adapter }, now: () => 1000 });
  return { provider, adapter };
}
afterEach(() => vi.useRealTimers());
describe("ZvukMusicProvider (mock boundaries only)", () => {
  it("makes no network calls by default and returns explicit UNSUPPORTED for all operations", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not be used"));
    const provider = new ZvukMusicProvider();
    for (const result of await Promise.all([provider.searchTracks({ query: "test" }), provider.getTrack("42"), provider.getUserLibrary(), provider.getPlaylists(), provider.resolvePlayback("42")])) expect(result.status).toBe("UNSUPPORTED");
    expect(network).not.toHaveBeenCalled();
    expect(provider.info).toMatchObject({ mode: "unconfigured", capabilities: { resolvePlayback: false, searchTracks: false } });
    expect(await provider.resolvePlayback("42")).toHaveProperty("officialUrl", "https://zvuk.com/track/42");
  });
  it("only dispatches approved metadata actions and never grants playback from metadata permission", async () => {
    const { provider, adapter } = mock(undefined, { ...approval, operations: ["searchTracks"] });
    const result = await provider.searchTracks({ query: "Test", limit: 1 });
    expect(result).toEqual({ status: "OK", data: [{ ...track, provider: "zvuk", officialUrl: "https://zvuk.com/track/42" }] });
    expect(adapter.request).toHaveBeenCalledWith("searchTracks", { query: "Test", limit: 1 }, expect.any(AbortSignal));
    expect(await provider.getTrack("42")).toMatchObject({ status: "UNSUPPORTED" });
    expect(await provider.resolvePlayback("42")).toMatchObject({ status: "UNSUPPORTED" });
    expect(adapter.request).toHaveBeenCalledTimes(1);
  });
  it("normalizes a permitted single track and checks requested identity", async () => {
    const { provider, adapter } = mock({ statusCode: 200, body: { track } });
    expect(await provider.getTrack("42")).toMatchObject({ status: "OK", data: { provider: "zvuk", id: "42", officialUrl: "https://zvuk.com/track/42" } });
    adapter.request.mockResolvedValue({ statusCode: 200, body: { track: { ...track, id: "99" } } });
    expect(await provider.getTrack("42")).toMatchObject({ status: "INVALID_RESPONSE" });
  });
  it("requires separate user authorization for private collections, not a SYNC room credential", async () => {
    const { provider, adapter } = mock();
    expect(await provider.getUserLibrary()).toMatchObject({ status: "ACCESS_DENIED" });
    expect(await provider.getPlaylists({ localRoom: { roomId: "abcdefghijkl", connectionId: "a" } })).toMatchObject({ status: "ACCESS_DENIED" });
    expect(adapter.request).not.toHaveBeenCalled();
    expect(await provider.getUserLibrary({ zvukAccountKey: "test-vault-account-reference" })).toMatchObject({ status: "OK", data: [{ id: "42" }] });
    adapter.request.mockResolvedValue({ statusCode: 200, body: { playlists: [{ id: "123", title: "Playlist", trackIds: ["42"] }] } });
    expect(await provider.getPlaylists({ zvukAccountKey: "test-vault-account-reference" })).toMatchObject({ status: "OK", data: [{ provider: "zvuk", id: "123", trackIds: ["42"] }] });
  });
  it("requires an account reference for metadata if anonymous access was not granted", async () => {
    const { provider, adapter } = mock(undefined, { ...approval, publicMetadata: false });
    expect(await provider.searchTracks({ query: "test" })).toMatchObject({ status: "ACCESS_DENIED" });
    expect(adapter.request).not.toHaveBeenCalled();
  });
  it.each([
    [401, undefined, "ACCESS_DENIED"], [401, "expired", "TOKEN_EXPIRED"], [403, undefined, "ACCESS_DENIED"],
    [404, undefined, "NOT_FOUND"], [429, undefined, "RATE_LIMITED"], [500, undefined, "SERVICE_UNAVAILABLE"],
    [503, undefined, "SERVICE_UNAVAILABLE"], [302, undefined, "INVALID_RESPONSE"], [400, undefined, "INVALID_RESPONSE"],
  ] as const)("maps upstream %s (%s) to %s with no raw body", async (statusCode, authFailure, status) => {
    const { provider } = mock({ statusCode, authFailure, body: { sensitive: "test-sensitive-marker" }, retryAfterSeconds: 30 });
    const result = await provider.searchTracks({ query: "test" });
    expect(result.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain("test-sensitive-marker");
    if (statusCode === 429) expect(result).toHaveProperty("retryAfterSeconds", 30);
  });
  it("sanitizes network exceptions and never logs upstream messages", async () => {
    const { provider, adapter } = mock();
    const error = vi.spyOn(console, "error"), log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn");
    adapter.request.mockRejectedValue(new Error("test-sensitive-marker"));
    const result = await provider.searchTracks({ query: "test" });
    expect(result.status).toBe("NETWORK_ERROR"); expect(JSON.stringify(result)).not.toContain("test-sensitive-marker");
    expect(error).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it("times out and aborts a stalled adapter without retrying or waiting forever", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const adapter: ApprovedZvukMetadataAdapter = { request: vi.fn<ApprovedZvukMetadataAdapter["request"]>((_operation, _input, requestSignal) => { signal = requestSignal; return new Promise<never>(() => {}); }) };
    const provider = new ZvukMusicProvider({ integration: { approval, adapter }, now: () => 1000, timeoutMs: 100 });
    const result = provider.searchTracks({ query: "test" });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ status: "SERVICE_UNAVAILABLE" }); expect(signal?.aborted).toBe(true);
    expect(adapter.request).toHaveBeenCalledTimes(1);
  });
  it("rejects stream URLs, invalid IDs and malformed normalized data", async () => {
    const { provider, adapter } = mock({ statusCode: 200, body: { tracks: [{ ...track, stream: "https://unapproved.invalid/audio" }] } });
    expect(await provider.searchTracks({ query: "test" })).toMatchObject({ status: "INVALID_RESPONSE" });
    adapter.request.mockResolvedValue({ statusCode: 200, body: { tracks: [{ ...track, id: "../escape" }] } });
    expect(await provider.searchTracks({ query: "test" })).toMatchObject({ status: "INVALID_RESPONSE" });
    expect(await provider.resolvePlayback("https://zvuk.com/track/42")).toMatchObject({ status: "INVALID_INPUT" });
    expect(await provider.searchTracks({ query: "", limit: 1 })).toMatchObject({ status: "INVALID_INPUT" });
  });
  it("fails closed on invalid or expired approval without affecting Local Music", async () => {
    const { provider, adapter } = mock(undefined, { ...approval, documentationUrl: "https://unapproved.invalid/docs" });
    expect(await provider.searchTracks({ query: "test" })).toMatchObject({ status: "UNSUPPORTED" });
    const expired = mock(undefined, { ...approval, validUntil: 999 }).provider;
    expect(await expired.getTrack("42")).toMatchObject({ status: "ACCESS_DENIED" });
    expect(expired.info.mode).toBe("unconfigured"); expect(adapter.request).not.toHaveBeenCalled();
    const local = new LocalMusicProvider(new MusicCatalog());
    expect(await local.getUserLibrary()).toEqual({ status: "OK", data: [] });
  });
  it("returns API limits through HTTP and never accepts room tokens for Zvuk", async () => {
    const { provider } = mock({ statusCode: 429, retryAfterSeconds: 30, body: null });
    const app = createApp(parseConfig({}), new MusicCatalog(), undefined, { local: new LocalMusicProvider(new MusicCatalog()), zvuk: provider });
    const response = await request(app).get("/api/music/zvuk/search?q=test").expect(429);
    expect(response.headers["retry-after"]).toBe("30"); expect(response.body.status).toBe("RATE_LIMITED");
    await request(app).get("/api/music/zvuk/library").expect(403);
    await request(app).get("/api/music/local/library").expect(200);
  });
});

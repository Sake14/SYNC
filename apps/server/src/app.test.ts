import { describe, expect, it } from "vitest";
import request from "supertest";
import { catalogSchema, healthSchema } from "@sync/shared";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";

const app = createApp(parseConfig({}));
describe("HTTP API", () => {
  it("returns a validated healthy response with caching disabled", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(healthSchema.safeParse(response.body).success).toBe(true);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
  it("returns an honest empty catalog", async () => {
    const response = await request(app).get("/api/catalog").expect(200);
    expect(catalogSchema.parse(response.body)).toEqual({ tracks: [] });
  });
  it("allows configured browser origins only", async () => {
    const allowed = await request(app).get("/health").set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const denied = await request(app).get("/health").set("Origin", "https://untrusted.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("does not bypass socket membership with unauthenticated HTTP room routes", async () => {
    const response = await request(app).post("/api/rooms").expect(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
describe("environment validation", () => {
  it("accepts comma-separated origins", () => {
    expect(parseConfig({ CLIENT_ORIGINS: "https://one.example, https://two.example" }).clientOrigins).toEqual(["https://one.example", "https://two.example"]);
  });
  it.each([{ PORT: "bad" }, { PORT: "65536" }, { CLIENT_ORIGINS: "*" }, { CLIENT_ORIGINS: "https://app.example/path" }, { MAX_ROOM_PARTICIPANTS: "0" }, { MAX_ROOM_PARTICIPANTS: "101" }, { MAX_ROOMS: "0" }, { RECONNECT_GRACE_MS: "0" }, { EMPTY_ROOM_TTL_MS: "5" }])("rejects invalid config %j", (env) => {
    expect(() => parseConfig(env)).toThrow("Invalid server configuration");
  });
});

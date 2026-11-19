import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "./testApp.js";

const NOW_MS = 1_700_000_000_000;
const NOW_S = 1_700_000_000;

let streamClient;
let getStreamClient;
let app;

beforeEach(() => {
  streamClient = { generateUserToken: vi.fn().mockReturnValue("fake-token") };
  getStreamClient = vi.fn(() => streamClient);
  ({ app } = buildTestApp({ getStreamClient, now: () => NOW_MS }));
});

describe("GET /api/stream/token", () => {
  it("issues a one-hour token backdated by a minute", async () => {
    const res = await request(app).get("/api/stream/token?userId=u1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: "fake-token" });
    expect(streamClient.generateUserToken).toHaveBeenCalledWith({
      user_id: "u1",
      valid_until: NOW_S + 3600,
      issued_at: NOW_S - 60,
    });
  });

  it("answers 400 without a userId and never builds the client", async () => {
    const res = await request(app).get("/api/stream/token");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "User ID is required" });
    expect(getStreamClient).not.toHaveBeenCalled();
  });

  it("hides client failures behind Internal server error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    streamClient.generateUserToken.mockImplementation(() => {
      throw new Error("invalid api secret abc123");
    });
    const res = await request(app).get("/api/stream/token?userId=u1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });
});

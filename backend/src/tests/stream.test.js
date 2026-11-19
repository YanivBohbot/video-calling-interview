import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, authAs, PRINCIPALS } from "./testApp.js";

const NOW_MS = 1_700_000_000_000;
const NOW_S = 1_700_000_000;
const { ada, demo, candidateOf } = PRINCIPALS;

let streamClient;
let app;

beforeEach(() => {
  streamClient = { generateUserToken: vi.fn().mockReturnValue("fake-token") };
  ({ app } = buildTestApp({ getStreamClient: () => streamClient, now: () => NOW_MS }));
});

const token = (principal, query = "") => request(app).get(`/api/stream/token${query}`).set(authAs(principal));

describe("GET /api/stream/token", () => {
  it("issues a one-hour token backdated by a minute, for the interviewer's Clerk id", async () => {
    const res = await token(ada);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: "fake-token", userId: "clerk_ada" });
    expect(streamClient.generateUserToken).toHaveBeenCalledWith({
      user_id: "clerk_ada",
      valid_until: NOW_S + 3600,
      issued_at: NOW_S - 60,
    });
  });

  it("gives each demo visitor a distinct demo- id", async () => {
    const first = (await token(demo)).body.userId;
    const second = (await token(demo)).body.userId;
    expect(first).toMatch(/^demo-[0-9a-f]{8}$/);
    expect(second).not.toBe(first);
  });

  it("gives a candidate an id scoped to their interview", async () => {
    const res = await token(candidateOf("iv-7"));
    expect(res.body.userId).toMatch(/^candidate-iv-7-[0-9a-f]{8}$/);
  });

  it("ignores a userId chosen by the client", async () => {
    const res = await token(ada, "?userId=someone-else");
    expect(res.body.userId).toBe("clerk_ada");
    expect(streamClient.generateUserToken).toHaveBeenCalledWith(expect.objectContaining({ user_id: "clerk_ada" }));
  });

  it("refuses callers without an identity", async () => {
    expect((await token(null)).status).toBe(401);
    expect(streamClient.generateUserToken).not.toHaveBeenCalled();
  });

  it("hides client failures behind Internal server error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    streamClient.generateUserToken.mockImplementation(() => {
      throw new Error("invalid api secret abc123");
    });
    const res = await token(ada);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });
});

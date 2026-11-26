import { describe, it, expect } from "vitest";
import { createLiveAvatarClient } from "../../../integrations/liveavatar/client.js";
import { UpstreamError } from "../../../shared/errors.js";

const AVATAR_ID = "avatar-1";

const fakeFetch = (response) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { fetch, calls };
};

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("createLiveAvatarClient", () => {
  it("returns null without an API key", () => {
    expect(createLiveAvatarClient({ avatarId: AVATAR_ID, sandbox: true })).toBeNull();
  });

  it("requests a FULL-mode session token and returns it", async () => {
    const { fetch, calls } = fakeFetch(reply(200, { code: 1000, data: { session_id: "s", session_token: "t" } }));
    const client = createLiveAvatarClient({ apiKey: "key", avatarId: AVATAR_ID, sandbox: false, fetch });

    const result = await client.createSessionToken({ language: "he", maxSeconds: 600 });

    expect(result).toEqual({ sessionToken: "t" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.liveavatar.com/v1/sessions/token");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["X-API-KEY"]).toBe("key");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      mode: "FULL",
      avatar_id: AVATAR_ID,
      is_sandbox: false,
      max_session_duration: 600,
      avatar_persona: { language: "he" },
    });
  });

  // The sandbox refuses any max_session_duration above its own 60 s cap (400).
  it("sends no max_session_duration in sandbox", async () => {
    const { fetch, calls } = fakeFetch(reply(200, { data: { session_token: "t" } }));
    const client = createLiveAvatarClient({ apiKey: "key", avatarId: AVATAR_ID, sandbox: true, fetch });
    await client.createSessionToken({ language: "en", maxSeconds: 600 });
    const body = JSON.parse(calls[0].init.body);
    expect(body.is_sandbox).toBe(true);
    expect(body).not.toHaveProperty("max_session_duration");
  });

  it("throws an UpstreamError on a non-2xx answer", async () => {
    const { fetch } = fakeFetch(reply(401, { message: "bad key" }));
    const client = createLiveAvatarClient({ apiKey: "key", avatarId: AVATAR_ID, sandbox: true, fetch });
    const err = await client.createSessionToken({ language: "en", maxSeconds: 60 }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toBe("Avatar service unavailable");
  });

  it("throws an UpstreamError when the token is missing", async () => {
    const { fetch } = fakeFetch(reply(200, { data: {} }));
    const client = createLiveAvatarClient({ apiKey: "key", avatarId: AVATAR_ID, sandbox: true, fetch });
    await expect(client.createSessionToken({ language: "en", maxSeconds: 60 })).rejects.toBeInstanceOf(UpstreamError);
  });

  it("throws an UpstreamError when the request itself fails", async () => {
    const fetch = async () => {
      throw new Error("network down");
    };
    const client = createLiveAvatarClient({ apiKey: "key", avatarId: AVATAR_ID, sandbox: true, fetch });
    await expect(client.createSessionToken({ language: "en", maxSeconds: 60 })).rejects.toBeInstanceOf(UpstreamError);
  });
});

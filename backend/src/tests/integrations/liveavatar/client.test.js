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
    const client = createLiveAvatarClient({ apiKey: "key", avatarId: AVATAR_ID, sandbox: true, fetch });

    const result = await client.createSessionToken({ language: "he", maxSeconds: 600 });

    expect(result).toEqual({ sessionToken: "t" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.liveavatar.com/v1/sessions/token");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["X-API-KEY"]).toBe("key");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      mode: "FULL",
      avatar_id: AVATAR_ID,
      is_sandbox: true,
      max_session_duration: 600,
      avatar_persona: { language: "he" },
    });
  });

  it("sends is_sandbox false when sandbox is off", async () => {
    const { fetch, calls } = fakeFetch(reply(200, { data: { session_token: "t" } }));
    const client = createLiveAvatarClient({ apiKey: "key", avatarId: AVATAR_ID, sandbox: false, fetch });
    await client.createSessionToken({ language: "en", maxSeconds: 60 });
    expect(JSON.parse(calls[0].init.body).is_sandbox).toBe(false);
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

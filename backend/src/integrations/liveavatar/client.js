// Server side of the LiveAvatar interviewer (https://docs.liveavatar.com): trades the API key
// for a short-lived session token the browser uses to start the avatar. The key never leaves
// the backend. FULL mode with no context_id: the avatar only speaks what the interviewer
// agent sends it, it never answers by itself.
import { UpstreamError } from "../../shared/errors.js";

const TOKEN_URL = "https://api.liveavatar.com/v1/sessions/token";
const UNAVAILABLE = "Avatar service unavailable";

// No API key → null: the feature is off.
export const createLiveAvatarClient = ({ apiKey, avatarId, sandbox, fetch = globalThis.fetch, timeoutMs = 10000 }) => {
  if (!apiKey) return null;

  const createSessionToken = async ({ language, maxSeconds }) => {
    let sessionToken;
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({
          mode: "FULL",
          avatar_id: avatarId,
          is_sandbox: sandbox,
          // The sandbox caps sessions at 60 s itself and refuses anything above (400).
          ...(sandbox ? {} : { max_session_duration: maxSeconds }),
          avatar_persona: { language },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`LiveAvatar answered ${res.status}`);
      sessionToken = (await res.json())?.data?.session_token;
    } catch (err) {
      throw new UpstreamError(UNAVAILABLE, { cause: err });
    }
    if (typeof sessionToken !== "string" || !sessionToken) {
      throw new UpstreamError(UNAVAILABLE, { cause: new Error("LiveAvatar returned no session token") });
    }
    return { sessionToken };
  };

  return { createSessionToken };
};

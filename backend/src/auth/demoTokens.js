import { SignJWT, jwtVerify } from "jose";

const AUDIENCE = "talentiq-demo";
const SUBJECT = "demo";
const LIFETIME_SECONDS = 8 * 60 * 60;

// Signed tokens for the "Continue as Guest" demo mode (HS256, server secret).
// `now` is injectable so expiry can be tested without waiting.
export const createDemoTokens = ({ secret, now = () => Date.now() }) => {
  const key = new TextEncoder().encode(secret);
  const nowSeconds = () => Math.floor(now() / 1000);

  const issue = async () => {
    const issuedAt = nowSeconds();
    const expiresAt = issuedAt + LIFETIME_SECONDS;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(SUBJECT)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(key);
    return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
  };

  // Never throws: anything that isn't a valid, unexpired demo token is simply `false`.
  const verify = async (token) => {
    if (typeof token !== "string" || !token) return false;
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["HS256"],
        audience: AUDIENCE,
        subject: SUBJECT,
        currentDate: new Date(now()),
      });
      return payload.sub === SUBJECT;
    } catch {
      return false;
    }
  };

  return { issue, verify };
};

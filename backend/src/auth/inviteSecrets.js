import crypto from "node:crypto";

const SECRET_BYTES = 32;

// The secret goes in the candidate's link; only its hash is stored, so a database
// leak doesn't leak working links.
export const hashInviteSecret = (secret) => crypto.createHash("sha256").update(secret).digest("hex");

export const generateInviteSecret = () => {
  const secret = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  return { secret, hash: hashInviteSecret(secret) };
};

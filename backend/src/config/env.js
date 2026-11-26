import { z } from "zod";

// A blank value (`KEY=` in .env) means "not set", as it did before config validation.
const blankAsUnset = (schema) => z.preprocess((v) => (v === "" ? undefined : v), schema);

const optional = blankAsUnset(z.string().min(1).optional());

// LangChain model strings are "provider:model"; a bare name (older .env files) means OpenAI.
const modelName = (fallback) =>
  blankAsUnset(z.string().min(1).default(fallback)).transform((name) => (name.includes(":") ? name : `openai:${name}`));

// "false" / "0" switch a flag off; anything else, or unset, keeps the default.
const flag = (fallback) =>
  blankAsUnset(z.string().optional()).transform((v) => (v === undefined ? fallback : !["false", "0"].includes(v.trim().toLowerCase())));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().min(1),
  PORT: blankAsUnset(z.coerce.number().int().positive().default(3000)),
  AI_QUESTION_COUNT: blankAsUnset(z.coerce.number().int().positive().default(6)),
  OPENAI_API_KEY: optional,
  AI_MODEL: modelName("openai:gpt-4o-mini"),
  AI_MODEL_FALLBACK: modelName("openai:gpt-4o"),
  STREAM_API_KEY: optional,
  STREAM_API_SECRET: optional,
  // Verifies Clerk session tokens and reads Clerk users (no publishable key needed server-side).
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: optional,
  // Signs the demo ("Continue as Guest") tokens.
  DEMO_TOKEN_SECRET: z.string().min(32),
  // The self-hosted Piston that runs candidate code (docker compose service "piston").
  PISTON_URL: blankAsUnset(z.string().url().default("http://localhost:2000")),
  // The LiveAvatar interviewer: no key = feature off. Sandbox is free (a fixed avatar, short sessions).
  LIVEAVATAR_API_KEY: optional,
  LIVEAVATAR_AVATAR_ID: blankAsUnset(z.string().min(1).default("dd73ea75-1218-4ef3-92ce-606d5f7fbc0a")),
  LIVEAVATAR_SANDBOX: flag(true),
});

// Parses the environment once, at boot (never on import, so tests need no env).
// On failure only variable *names* are reported: zod messages can echo the values.
export const loadConfig = (env) => {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid environment: ${names.join(", ")}`);
  }
  const e = result.data;
  return Object.freeze({
    port: e.PORT,
    clientUrl: e.CLIENT_URL,
    databaseUrl: e.DATABASE_URL,
    aiQuestionCount: e.AI_QUESTION_COUNT,
    aiModel: e.AI_MODEL,
    aiModelFallback: e.AI_MODEL_FALLBACK,
    openaiApiKey: e.OPENAI_API_KEY,
    stream: Object.freeze({ apiKey: e.STREAM_API_KEY, apiSecret: e.STREAM_API_SECRET }),
    clerk: Object.freeze({ secretKey: e.CLERK_SECRET_KEY, publishableKey: e.CLERK_PUBLISHABLE_KEY }),
    demoTokenSecret: e.DEMO_TOKEN_SECRET,
    pistonUrl: e.PISTON_URL,
    liveAvatar: Object.freeze({
      apiKey: e.LIVEAVATAR_API_KEY,
      avatarId: e.LIVEAVATAR_AVATAR_ID,
      sandbox: e.LIVEAVATAR_SANDBOX,
    }),
  });
};

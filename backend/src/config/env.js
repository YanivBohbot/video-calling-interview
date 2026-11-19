import { z } from "zod";

// A blank value (`KEY=` in .env) means "not set", as it did before config validation.
const blankAsUnset = (schema) => z.preprocess((v) => (v === "" ? undefined : v), schema);

const optional = blankAsUnset(z.string().min(1).optional());

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().min(1),
  PORT: blankAsUnset(z.coerce.number().int().positive().default(3000)),
  AI_QUESTION_COUNT: blankAsUnset(z.coerce.number().int().positive().default(6)),
  OPENAI_API_KEY: optional,
  STREAM_API_KEY: optional,
  STREAM_API_SECRET: optional,
  // Verifies Clerk session tokens and reads Clerk users (no publishable key needed server-side).
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: optional,
  // Signs the demo ("Continue as Guest") tokens.
  DEMO_TOKEN_SECRET: z.string().min(32),
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
    openaiApiKey: e.OPENAI_API_KEY,
    stream: Object.freeze({ apiKey: e.STREAM_API_KEY, apiSecret: e.STREAM_API_SECRET }),
    clerk: Object.freeze({ secretKey: e.CLERK_SECRET_KEY, publishableKey: e.CLERK_PUBLISHABLE_KEY }),
    demoTokenSecret: e.DEMO_TOKEN_SECRET,
  });
};

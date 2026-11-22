import { describe, it, expect } from "vitest";
import { loadConfig } from "./env.js";

const base = {
  DATABASE_URL: "postgres://x",
  CLIENT_URL: "http://localhost:5174",
  CLERK_SECRET_KEY: "sk_test_fake",
  DEMO_TOKEN_SECRET: "test-demo-secret-0123456789abcdef0123",
};

describe("loadConfig", () => {
  it("applies defaults for port and question count", () => {
    const config = loadConfig(base);
    expect(config.port).toBe(3000);
    expect(config.aiQuestionCount).toBe(6);
    expect(config.clientUrl).toBe("http://localhost:5174");
    expect(config.databaseUrl).toBe("postgres://x");
  });

  it("coerces numeric variables", () => {
    const config = loadConfig({ ...base, PORT: "3001", AI_QUESTION_COUNT: "4" });
    expect(config.port).toBe(3001);
    expect(config.aiQuestionCount).toBe(4);
  });

  it("exposes optional keys without requiring them", () => {
    const config = loadConfig({ ...base, OPENAI_API_KEY: "sk-test", STREAM_API_KEY: "k", STREAM_API_SECRET: "s" });
    expect(config.openaiApiKey).toBe("sk-test");
    expect(config.stream).toEqual({ apiKey: "k", apiSecret: "s" });
    expect(loadConfig(base).openaiApiKey).toBeUndefined();
  });

  it("defaults PISTON_URL to the local Piston container", () => {
    expect(loadConfig(base).pistonUrl).toBe("http://localhost:2000");
  });

  it("reads PISTON_URL when set", () => {
    expect(loadConfig({ ...base, PISTON_URL: "http://piston:2000" }).pistonUrl).toBe("http://piston:2000");
  });

  it("names missing variables without echoing any value", () => {
    let message = "";
    try {
      loadConfig({ CLIENT_URL: "http://a", OPENAI_API_KEY: "sk-SECRETVALUE" });
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("SECRETVALUE");
  });

  it("does not echo an invalid value", () => {
    expect(() => loadConfig({ ...base, PORT: "not-a-SECRET-port" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PORT: "not-a-SECRET-port" })).not.toThrow(/SECRET/);
  });

  it("treats blank values (e.g. copied from .env.example) as absent", () => {
    const config = loadConfig({ ...base, OPENAI_API_KEY: "", STREAM_API_SECRET: "", PORT: "", AI_QUESTION_COUNT: "" });
    expect(config.port).toBe(3000);
    expect(config.aiQuestionCount).toBe(6);
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.stream.apiSecret).toBeUndefined();
  });

  it.each(["CLERK_SECRET_KEY", "DEMO_TOKEN_SECRET"])("requires %s and names it without echoing values", (name) => {
    const env = { ...base, OPENAI_API_KEY: "sk-SECRETVALUE" };
    delete env[name];
    let message = "";
    try {
      loadConfig(env);
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain(name);
    expect(message).not.toContain("SECRETVALUE");
  });

  it("rejects a demo token secret shorter than 32 characters", () => {
    expect(() => loadConfig({ ...base, DEMO_TOKEN_SECRET: "short-SECRET" })).toThrow(/DEMO_TOKEN_SECRET/);
    expect(() => loadConfig({ ...base, DEMO_TOKEN_SECRET: "short-SECRET" })).not.toThrow(/short-SECRET/);
  });

  it("exposes the Clerk and demo settings", () => {
    const config = loadConfig({ ...base, CLERK_PUBLISHABLE_KEY: "pk_test_fake" });
    expect(config.clerk).toEqual({ secretKey: "sk_test_fake", publishableKey: "pk_test_fake" });
    expect(config.demoTokenSecret).toBe("test-demo-secret-0123456789abcdef0123");
  });

  it("defaults the AI models to full provider:model strings", () => {
    const config = loadConfig(base);
    expect(config.aiModel).toBe("openai:gpt-4o-mini");
    expect(config.aiModelFallback).toBe("openai:gpt-4o");
  });

  it("keeps provider:model strings and treats a bare model name as OpenAI (older .env files)", () => {
    const config = loadConfig({ ...base, AI_MODEL: "anthropic:claude-sonnet-5", AI_MODEL_FALLBACK: "gpt-4o" });
    expect(config.aiModel).toBe("anthropic:claude-sonnet-5");
    expect(config.aiModelFallback).toBe("openai:gpt-4o");
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(loadConfig(base))).toBe(true);
  });
});

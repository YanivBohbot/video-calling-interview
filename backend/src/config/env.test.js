import { describe, it, expect } from "vitest";
import { loadConfig } from "./env.js";

const base = { DATABASE_URL: "postgres://x", CLIENT_URL: "http://localhost:5174" };

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

  it("returns a frozen object", () => {
    expect(Object.isFrozen(loadConfig(base))).toBe(true);
  });
});

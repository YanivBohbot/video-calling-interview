import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimiter } from "./rateLimiter.js";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("allows up to `max` calls within the window", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });
    expect(limiter.check("user-a")).toEqual({ ok: true });
    expect(limiter.check("user-a")).toEqual({ ok: true });
    expect(limiter.check("user-a")).toEqual({ ok: true });
  });

  it("rejects the (max+1)th call with retryAfter seconds", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    limiter.check("user-a");
    limiter.check("user-a");
    const result = limiter.check("user-a");
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it("isolates buckets by key", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.check("user-a").ok).toBe(true);
    expect(limiter.check("user-b").ok).toBe(true);
    expect(limiter.check("user-a").ok).toBe(false);
  });

  it("allows again after the window passes", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.check("user-a").ok).toBe(true);
    expect(limiter.check("user-a").ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(limiter.check("user-a").ok).toBe(true);
  });
});

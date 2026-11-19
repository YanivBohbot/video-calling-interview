import { describe, it, expect, vi, afterEach } from "vitest";
import { createFlushScheduler } from "./flushScheduler.js";

afterEach(() => vi.useRealTimers());

describe("flushScheduler", () => {
  it("flushes on every interval tick", async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue();
    const scheduler = createFlushScheduler({ flush, intervalMs: 10_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(flush).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("skips a tick while the previous flush is still running", async () => {
    vi.useFakeTimers();
    let release;
    const flush = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const scheduler = createFlushScheduler({ flush, intervalMs: 10_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(flush).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(flush).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("stop() clears the interval", async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue();
    const scheduler = createFlushScheduler({ flush, intervalMs: 10_000 });
    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(flush).not.toHaveBeenCalled();
  });

  it("logs a failed flush and keeps going", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const flush = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue();
    const scheduler = createFlushScheduler({ flush, intervalMs: 10_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalled();
    scheduler.stop();
  });

  it("flushNow waits for an in-flight flush, then flushes once more", async () => {
    vi.useFakeTimers();
    const order = [];
    let release;
    const flush = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => { order.push("tick"); resolve(); })))
      .mockImplementation(async () => order.push("final"));
    const scheduler = createFlushScheduler({ flush, intervalMs: 10_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);
    scheduler.stop();
    const done = scheduler.flushNow();
    release();
    await done;
    expect(order).toEqual(["tick", "final"]);
  });
});

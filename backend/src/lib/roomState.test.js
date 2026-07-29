import { describe, it, expect, vi } from "vitest";
import { applyCodeChange, applyLanguageChange, flushAllDirty, flushRoomOnExit } from "./roomState.js";

describe("applyCodeChange", () => {
  it("creates a new entry with dirty=true on first call", () => {
    const state = new Map();
    applyCodeChange(state, "room-1", "console.log(1)");
    expect(state.get("room-1")).toEqual({
      code: "console.log(1)",
      language: "javascript",
      dirty: true,
    });
  });

  it("updates an existing entry's code without touching its language", () => {
    const state = new Map([["room-1", { code: "old", language: "python", dirty: false }]]);
    applyCodeChange(state, "room-1", "new code");
    expect(state.get("room-1")).toEqual({ code: "new code", language: "python", dirty: true });
  });
});

describe("applyLanguageChange", () => {
  it("creates a new entry with dirty=true on first call", () => {
    const state = new Map();
    applyLanguageChange(state, "room-1", "python");
    expect(state.get("room-1")).toEqual({ code: "", language: "python", dirty: true });
  });

  it("updates an existing entry's language without touching its code", () => {
    const state = new Map([["room-1", { code: "keep me", language: "javascript", dirty: false }]]);
    applyLanguageChange(state, "room-1", "cpp");
    expect(state.get("room-1")).toEqual({ code: "keep me", language: "cpp", dirty: true });
  });
});

describe("flushAllDirty", () => {
  it("writes dirty rooms to the DB and clears their dirty flag", async () => {
    const state = new Map([
      ["room-1", { code: "a", language: "javascript", dirty: true }],
      ["room-2", { code: "b", language: "python", dirty: false }],
    ]);
    const update = vi.fn().mockResolvedValue({});
    await flushAllDirty(state, { update });

    // Exactly one write, and it was for room-1 — the already-clean room-2 was
    // never sent to the DB at all.
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { codeSnapshot: "a", codeLanguage: "javascript" },
    });
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "room-2" } }),
    );
    expect(state.get("room-1").dirty).toBe(false);
    expect(state.get("room-2")).toEqual({ code: "b", language: "python", dirty: false });
  });

  it("keeps a room dirty when a new edit lands mid-flush (lost-update race)", async () => {
    const entry = { code: "old", language: "javascript", dirty: true };
    const state = new Map([["room-1", entry]]);

    // Simulate a `code-change` arriving while the DB write is still in flight:
    // the value that actually lands in Postgres is "old", not "newer".
    const update = vi.fn().mockImplementation(async () => {
      entry.code = "newer";
      return {};
    });

    await flushAllDirty(state, { update });

    expect(update).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { codeSnapshot: "old", codeLanguage: "javascript" },
    });
    // Must stay dirty so the next flush pass (or flush-on-exit) persists "newer".
    expect(state.get("room-1").dirty).toBe(true);
    expect(state.get("room-1").code).toBe("newer");
  });

  it("keeps a room dirty when the language changes mid-flush", async () => {
    const entry = { code: "a", language: "javascript", dirty: true };
    const state = new Map([["room-1", entry]]);

    const update = vi.fn().mockImplementation(async () => {
      entry.language = "python";
      return {};
    });

    await flushAllDirty(state, { update });

    expect(state.get("room-1").dirty).toBe(true);
  });

  it("leaves a room dirty and does not throw when the update fails with P2025", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: true }]]);
    const err = Object.assign(new Error("not found"), { code: "P2025" });
    const update = vi.fn().mockRejectedValue(err);

    await expect(flushAllDirty(state, { update })).resolves.toBeUndefined();
    expect(state.get("room-1").dirty).toBe(true);
  });

  it("does not throw on an unexpected error either, and leaves the room dirty", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: true }]]);
    const update = vi.fn().mockRejectedValue(new Error("connection reset"));

    await expect(flushAllDirty(state, { update })).resolves.toBeUndefined();
    expect(state.get("room-1").dirty).toBe(true);
  });
});

describe("flushRoomOnExit", () => {
  it("flushes a dirty room then removes it from state", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: true }]]);
    const update = vi.fn().mockResolvedValue({});

    await flushRoomOnExit(state, { update }, "room-1");

    expect(update).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { codeSnapshot: "a", codeLanguage: "javascript" },
    });
    expect(state.has("room-1")).toBe(false);
  });

  it("removes a clean room without calling update", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: false }]]);
    const update = vi.fn();

    await flushRoomOnExit(state, { update }, "room-1");

    expect(update).not.toHaveBeenCalled();
    expect(state.has("room-1")).toBe(false);
  });

  it("is a no-op when the room does not exist in state", async () => {
    const state = new Map();
    const update = vi.fn();

    await expect(flushRoomOnExit(state, { update }, "missing-room")).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});

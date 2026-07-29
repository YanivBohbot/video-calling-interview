import { describe, it, expect } from "vitest";
import { applyCodeChange, applyLanguageChange } from "./roomState.js";

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

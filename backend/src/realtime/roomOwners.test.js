import { describe, it, expect } from "vitest";
import { addOwner, removeOwner, isOwnerPresent } from "./roomOwners.js";

describe("roomOwners", () => {
  it("counts owners: present until the last one leaves", () => {
    const map = new Map();
    addOwner(map, "r1");
    addOwner(map, "r1");
    expect(removeOwner(map, "r1")).toBe(1);
    expect(isOwnerPresent(map, "r1")).toBe(true);
    expect(removeOwner(map, "r1")).toBe(0);
    expect(isOwnerPresent(map, "r1")).toBe(false);
  });

  it("removing from an unknown room gives 0, never a negative count", () => {
    const map = new Map();
    expect(removeOwner(map, "nope")).toBe(0);
    expect(addOwner(map, "nope")).toBe(1);
  });
});

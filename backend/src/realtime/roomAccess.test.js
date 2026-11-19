import { describe, it, expect, vi } from "vitest";
import { createRoomAccess } from "./roomAccess.js";

const interviewRepository = {
  findById: vi.fn(async (id) => (id === "iv-a" ? { id: "iv-a", interviewerId: "u-ada" } : null)),
};
const canAccessRoom = createRoomAccess({ interviewRepository });

describe("room access", () => {
  it("lets an owner into their own interview's room only", async () => {
    expect(await canAccessRoom({ kind: "interviewer", userId: "u-ada" }, "iv-a")).toBe(true);
    expect(await canAccessRoom({ kind: "interviewer", userId: "u-bob" }, "iv-a")).toBe(false);
    expect(await canAccessRoom({ kind: "demo", userId: "u-demo" }, "iv-a")).toBe(false);
  });

  it("refuses unknown rooms (e.g. the old 'default' id)", async () => {
    expect(await canAccessRoom({ kind: "interviewer", userId: "u-ada" }, "default")).toBe(false);
  });

  it("lets a candidate into the invited interview only, without a DB read", async () => {
    interviewRepository.findById.mockClear();
    expect(await canAccessRoom({ kind: "candidate", interviewId: "iv-a" }, "iv-a")).toBe(true);
    expect(await canAccessRoom({ kind: "candidate", interviewId: "iv-a" }, "iv-b")).toBe(false);
    expect(interviewRepository.findById).not.toHaveBeenCalled();
  });

  it("refuses a missing principal", async () => {
    expect(await canAccessRoom(undefined, "iv-a")).toBe(false);
  });
});

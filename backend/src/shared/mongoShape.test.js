import { describe, it, expect } from "vitest";
import { toDoc, toUserDoc, toInterviewDoc } from "./mongoShape.js";

describe("mongoShape", () => {
  it("toDoc renames id to _id", () => {
    expect(toDoc({ id: "s1", problem: "Two Sum" })).toEqual({ _id: "s1", problem: "Two Sum" });
    expect(toDoc(null)).toBeNull();
  });

  it("toUserDoc renames id and clerkId", () => {
    expect(toUserDoc({ id: "u1", clerkId: "c1", name: "A" })).toEqual({ _id: "u1", clerkID: "c1", name: "A" });
  });

  it("toInterviewDoc nests the interviewer and drops raw keys", () => {
    const doc = toInterviewDoc({
      id: "iv1",
      interviewerId: "u1",
      role: "Dev",
      interviewer: { id: "u1", name: "A", email: "a@x", clerkId: "c1" },
    });
    expect(doc).toEqual({
      _id: "iv1",
      role: "Dev",
      interviewerId: { _id: "u1", name: "A", email: "a@x", clerkID: "c1" },
    });
  });

  it("toInterviewDoc keeps interviewerId a string without an interviewer", () => {
    expect(toInterviewDoc({ id: "iv1", interviewerId: "u1" })).toEqual({ _id: "iv1", interviewerId: "u1" });
  });
});

import { describe, it, expect, vi } from "vitest";
import { createPracticeSessionRepository } from "../../repositories/practiceSession.repository.js";

const repoWith = (practiceSession) => createPracticeSessionRepository({ prisma: { aiPracticeSession: practiceSession } });

describe("practiceSession repository", () => {
  it("claimMessage increments atomically, only while active and under the cap", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const ok = await repoWith({ updateMany }).claimMessage("s1", { max: 60, code: "x", language: "python" });
    expect(ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "s1", status: "active", messageCount: { lt: 60 } },
      data: { messageCount: { increment: 1 }, code: "x", language: "python" },
    });
  });

  it("claimMessage is false when nothing was updated (cap reached, finished, or lost race)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    expect(await repoWith({ updateMany }).claimMessage("s1", { max: 60, code: "", language: "python" })).toBe(false);
  });

  it("finish only moves an active session to finished", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    expect(await repoWith({ updateMany }).finish("s1")).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "s1", status: "active" },
      data: { status: "finished", finishedAt: expect.any(Date) },
    });
    updateMany.mockResolvedValue({ count: 0 });
    expect(await repoWith({ updateMany }).finish("s1")).toBe(false);
  });

  it("listForInterview never selects the code or the report", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await repoWith({ findMany }).listForInterview("iv-1");
    const { where, select } = findMany.mock.calls[0][0];
    expect(where).toEqual({ interviewId: "iv-1" });
    expect(select).toEqual({ id: true, status: true, startedAt: true, finishedAt: true });
  });

  it("countSince counts the link's sessions started since it was created", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const since = new Date("2026-11-20T00:00:00Z");
    expect(await repoWith({ count }).countSince("iv-1", since)).toBe(2);
    expect(count).toHaveBeenCalledWith({ where: { interviewId: "iv-1", startedAt: { gte: since } } });
  });

  it("findActive returns the interview's active session", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "s1" });
    expect(await repoWith({ findFirst }).findActive("iv-1")).toEqual({ id: "s1" });
    expect(findFirst).toHaveBeenCalledWith({ where: { interviewId: "iv-1", status: "active" } });
  });
});

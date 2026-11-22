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
});

describe("practiceSession repository — findActive", () => {
  it("returns the interview's active session", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "s1" });
    expect(await repoWith({ findFirst }).findActive("iv-1")).toEqual({ id: "s1" });
    expect(findFirst).toHaveBeenCalledWith({ where: { interviewId: "iv-1", status: "active" } });
  });
});

describe("practiceSession repository — startExclusive", () => {
  const STALE = new Date("2026-11-22T11:00:00Z");
  const txWith = (session) => {
    const calls = [];
    const tx = {
      $executeRaw: vi.fn(async () => calls.push("lock")),
      aiPracticeSession: {
        findFirst: vi.fn(async () => (calls.push("findFirst"), session.active)),
        update: vi.fn(async () => calls.push("update")),
        count: vi.fn(async () => (calls.push("count"), session.used)),
        create: vi.fn(async ({ data }) => (calls.push("create"), { id: "new", ...data })),
      },
    };
    const prisma = { aiPracticeSession: {}, $transaction: vi.fn(async (fn) => fn(tx)) };
    return { repo: createPracticeSessionRepository({ prisma }), tx, calls };
  };
  const start = (repo) => repo.startExclusive({ interviewId: "iv-1", language: "python", max: 3, staleBefore: STALE });

  it("takes the interview's lock before reading, then creates", async () => {
    const { repo, calls } = txWith({ active: null, used: 0 });
    expect(await start(repo)).toEqual({ session: { id: "new", interviewId: "iv-1", language: "python" }, closedId: null });
    expect(calls).toEqual(["lock", "findFirst", "count", "create"]);
  });

  it("refuses while a recent session is active", async () => {
    const { repo, tx } = txWith({ active: { id: "s1", startedAt: new Date("2026-11-22T11:30:00Z") }, used: 1 });
    expect(await start(repo)).toEqual({ conflict: "active" });
    expect(tx.aiPracticeSession.create).not.toHaveBeenCalled();
  });

  it("closes an abandoned active session, then starts", async () => {
    const { repo, tx } = txWith({ active: { id: "s1", startedAt: new Date("2026-11-22T10:00:00Z") }, used: 1 });
    expect(await start(repo)).toMatchObject({ session: { id: "new" }, closedId: "s1" });
    expect(tx.aiPracticeSession.update).toHaveBeenCalledWith({
      where: { id: "s1" }, data: { status: "finished", finishedAt: expect.any(Date) },
    });
  });

  it("refuses past the cap", async () => {
    const { repo, tx } = txWith({ active: null, used: 3 });
    expect(await start(repo)).toEqual({ conflict: "limit", closedId: null });
    expect(tx.aiPracticeSession.count).toHaveBeenCalledWith({ where: { interviewId: "iv-1" } });
    expect(tx.aiPracticeSession.create).not.toHaveBeenCalled();
  });
});

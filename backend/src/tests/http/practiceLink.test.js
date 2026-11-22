import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, authAs, PRINCIPALS } from "../helpers/testApp.js";
import { hashInviteSecret } from "../../auth/inviteSecrets.js";

// The interviewer side of practice links: create one, see only when it was used.
const { ada, bob, demo, candidateOf } = PRINCIPALS;
const CREATED = new Date("2026-11-20T09:00:00Z");

let prisma;
let app;

beforeEach(() => {
  const interview = { id: "iv-1", interviewerId: "u-ada", practiceCreatedAt: CREATED };
  prisma = {
    interview: {
      findUnique: vi.fn(async ({ where }) => (where.id === "iv-1" ? interview : null)),
      update: vi.fn().mockResolvedValue({ id: "iv-1" }),
    },
    aiPracticeSession: {
      findMany: vi.fn().mockResolvedValue([
        { id: "s1", status: "finished", startedAt: new Date("2026-11-21T10:00:00Z"), finishedAt: new Date("2026-11-21T10:40:00Z") },
      ]),
    },
  };
  ({ app } = buildTestApp({ prisma, principal: ada }));
});

describe("POST /api/interviews/:id/practice", () => {
  it("gives the owner a practice link and stores only the secret's hash", async () => {
    const res = await request(app).post("/api/interviews/iv-1/practice");
    expect(res.status).toBe(200);
    const match = res.body.url.match(/^http:\/\/localhost:5174\/practice\/iv-1#practice=([A-Za-z0-9_-]{43})$/);
    expect(match).not.toBeNull();
    expect(prisma.interview.update).toHaveBeenCalledWith({
      where: { id: "iv-1" },
      data: { practiceTokenHash: hashInviteSecret(match[1]), practiceCreatedAt: expect.any(Date) },
      select: { id: true },
    });
  });

  it("answers 404 to another interviewer and 403 to a candidate", async () => {
    expect((await request(app).post("/api/interviews/iv-1/practice").set(authAs(bob))).status).toBe(404);
    expect((await request(app).post("/api/interviews/iv-1/practice").set(authAs(candidateOf("iv-1")))).status).toBe(403);
  });

  it("lets the demo account create links for its interviews", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-d", interviewerId: "u-demo" });
    expect((await request(app).post("/api/interviews/iv-d/practice").set(authAs(demo))).status).toBe(200);
  });
});

describe("demo budget", () => {
  it("caps practice links for the public demo at 3 per hour, shared by all visitors", async () => {
    prisma.interview.findUnique.mockImplementation(async ({ where }) =>
      where.id === "iv-d" ? { id: "iv-d", interviewerId: "u-demo" } : { id: "iv-1", interviewerId: "u-ada" },
    );
    for (let i = 0; i < 3; i++) expect((await request(app).post("/api/interviews/iv-d/practice").set(authAs(demo))).status).toBe(200);
    const blocked = await request(app).post("/api/interviews/iv-d/practice").set(authAs(demo));
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
    // Signed-in interviewers are not affected.
    expect((await request(app).post("/api/interviews/iv-1/practice")).status).toBe(200);
  });
});

describe("GET /api/interviews/:id/practice", () => {
  it("shows the owner when the link was created and when it was used — nothing else", async () => {
    const res = await request(app).get("/api/interviews/iv-1/practice");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      createdAt: CREATED.toISOString(),
      sessions: [{ status: "finished", startedAt: "2026-11-21T10:00:00.000Z", finishedAt: "2026-11-21T10:40:00.000Z" }],
    });
    const text = JSON.stringify(res.body);
    for (const secret of ["code", "report", "messageCount", "messages"]) expect(text).not.toContain(secret);
  });

  it("answers 404 to another interviewer", async () => {
    expect((await request(app).get("/api/interviews/iv-1/practice").set(authAs(bob))).status).toBe(404);
  });
});

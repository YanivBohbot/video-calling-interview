import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, authAs, PRINCIPALS } from "../helpers/testApp.js";
import { hashInviteSecret } from "../../auth/inviteSecrets.js";

// The spec's access table, row by row, over a tiny in-memory interviews table.
const { ada, bob, demo, candidateOf } = PRINCIPALS;

const USERS = {
  "u-ada": { id: "u-ada", name: "Ada", email: "ada@x.dev", clerkId: "clerk_ada" },
  "u-bob": { id: "u-bob", name: "Bob", email: "bob@x.dev", clerkId: "clerk_bob" },
  "u-demo": { id: "u-demo", name: "Demo User", email: "demo@talentiq.dev", clerkId: "demo" },
};

const pick = (record, select) =>
  select ? Object.fromEntries(Object.keys(select).filter((k) => k !== "interviewer").map((k) => [k, record[k]])) : { ...record };

const withInterviewer = (record, args) => {
  const out = pick(record, args.select);
  if (args.include?.interviewer || args.select?.interviewer) {
    const u = USERS[record.interviewerId];
    out.interviewer = { id: u.id, name: u.name, email: u.email, clerkId: u.clerkId };
  }
  return out;
};

const matches = (record, where = {}) => Object.entries(where).every(([k, v]) => record[k] === v);

const fakePrisma = (rows) => {
  const notFound = () => Object.assign(new Error("not found"), { code: "P2025" });
  return {
    interview: {
      findMany: async (args = {}) => rows.filter((r) => matches(r, args.where)).map((r) => withInterviewer(r, args)),
      findUnique: async (args) => {
        const r = rows.find((x) => matches(x, args.where));
        return r ? withInterviewer(r, args) : null;
      },
      create: async (args) => {
        const r = { id: `iv-${rows.length + 1}`, questions: null, codeSnapshot: null, ...args.data };
        rows.push(r);
        return withInterviewer(r, args);
      },
      update: async (args) => {
        const r = rows.find((x) => x.id === args.where.id);
        if (!r) throw notFound();
        Object.assign(r, args.data);
        return withInterviewer(r, args);
      },
      delete: async (args) => {
        const i = rows.findIndex((x) => x.id === args.where.id);
        if (i < 0) throw notFound();
        return rows.splice(i, 1)[0];
      },
      count: async (args = {}) => rows.filter((r) => matches(r, args.where)).length,
    },
  };
};

const row = (id, interviewerId, extra = {}) => ({
  id,
  interviewerId,
  candidateName: `Cand ${id}`,
  candidateEmail: `${id}@x.dev`,
  role: "Backend",
  scheduledAt: "2026-12-01T10:00:00.000Z",
  status: "scheduled",
  duration: 60,
  interviewType: "technical",
  notes: "secret notes",
  codeLanguage: "javascript",
  codeSnapshot: "x()",
  questions: [{ text: "Q1", category: "technical", difficulty: "easy" }],
  inviteTokenHash: null,
  ...extra,
});

let rows;
let app;

beforeEach(() => {
  rows = [row("iv-a", "u-ada"), row("iv-b", "u-bob"), row("iv-d", "u-demo", { status: "completed", duration: 30 })];
  ({ app } = buildTestApp({ prisma: fakePrisma(rows) }));
});

const as = (principal) => ({
  get: (url) => request(app).get(url).set(authAs(principal)),
  post: (url, body) => request(app).post(url).set(authAs(principal)).send(body),
  patch: (url, body) => request(app).patch(url).set(authAs(principal)).send(body),
  del: (url) => request(app).delete(url).set(authAs(principal)),
});

describe("ownership", () => {
  it("lists only the caller's interviews", async () => {
    const res = await as(ada).get("/api/interviews");
    expect(res.body.map((iv) => iv._id)).toEqual(["iv-a"]);
  });

  it("answers 404 when another interviewer reads, edits or deletes it", async () => {
    expect((await as(bob).get("/api/interviews/iv-a")).status).toBe(404);
    expect((await as(bob).patch("/api/interviews/iv-a", { notes: "hijack" })).status).toBe(404);
    expect((await as(bob).patch("/api/interviews/iv-a/status", { status: "cancelled" })).status).toBe(404);
    const del = await as(bob).del("/api/interviews/iv-a");
    expect(del.status).toBe(404);
    expect(del.body).toEqual({ message: "Interview not found" });
    expect(rows.find((r) => r.id === "iv-a")).toMatchObject({ notes: "secret notes", status: "scheduled" });
  });

  it("lets the owner read and edit", async () => {
    expect((await as(ada).get("/api/interviews/iv-a")).status).toBe(200);
    expect((await as(ada).patch("/api/interviews/iv-a", { notes: "ok" })).body.notes).toBe("ok");
  });

  it("creates the interview for the caller, ignoring any interviewer in the body", async () => {
    const res = await as(ada).post("/api/interviews", {
      candidateName: "Grace",
      candidateEmail: "g@x.dev",
      role: "Backend",
      scheduledAt: "2026-12-02T10:00:00.000Z",
      interviewerId: "u-bob",
    });
    expect(res.status).toBe(201);
    expect(rows.at(-1).interviewerId).toBe("u-ada");
  });

  it("scopes dashboard stats and activity to the caller, without totalUsers", async () => {
    const stats = await as(demo).get("/api/interviews/stats");
    expect(stats.body).toEqual({ total: 1, completed: 1, live: 0, scheduled: 0, cancelled: 0, avgDuration: 30 });
    const activity = await as(ada).get("/api/interviews/activity");
    expect(activity.body.map((a) => a.id)).toEqual(["iv-a"]);
  });

  it("forbids deleting in demo mode", async () => {
    const res = await as(demo).del("/api/interviews/iv-d");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Not allowed in demo mode" });
    expect(rows.some((r) => r.id === "iv-d")).toBe(true);
  });
});

describe("candidates", () => {
  it("cannot use interviewer routes", async () => {
    const candidate = candidateOf("iv-a");
    expect((await as(candidate).get("/api/interviews")).status).toBe(403);
    expect((await as(candidate).get("/api/interviews/iv-a")).status).toBe(403);
    expect((await as(candidate).get("/api/interviews/stats")).status).toBe(403);
    const res = await as(candidate).post("/api/interviews/iv-a/invite");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Forbidden" });
  });

  it("gets a reduced room view without questions or notes", async () => {
    const res = await as(candidateOf("iv-a")).get("/api/interviews/iv-a/room");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      _id: "iv-a",
      candidateName: "Cand iv-a",
      role: "Backend",
      interviewType: "technical",
      scheduledAt: "2026-12-01T10:00:00.000Z",
      duration: 60,
      status: "scheduled",
      codeLanguage: "javascript",
      codeSnapshot: "x()",
      viewer: "candidate",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Q1|secret notes|ada@x.dev/);
  });

  it("answers 404 for another interview's room", async () => {
    expect((await as(candidateOf("iv-a")).get("/api/interviews/iv-b/room")).status).toBe(404);
  });

  it("gives the owner the full view on /room, and strangers a 404", async () => {
    const owner = await as(ada).get("/api/interviews/iv-a/room");
    expect(owner.body.questions).toHaveLength(1);
    expect((await as(bob).get("/api/interviews/iv-a/room")).status).toBe(404);
  });
});

describe("invite links", () => {
  it("returns a fragment URL whose secret hash is stored, and regenerating replaces it", async () => {
    const first = await as(ada).post("/api/interviews/iv-a/invite");
    expect(first.status).toBe(200);
    expect(first.body.url).toMatch(/^http:\/\/localhost:5174\/room\/iv-a#invite=[A-Za-z0-9_-]{43}$/);
    const secret = first.body.url.split("#invite=")[1];
    expect(rows[0].inviteTokenHash).toBe(hashInviteSecret(secret));
    expect(rows[0].inviteCreatedAt).toBeInstanceOf(Date);

    const second = await as(ada).post("/api/interviews/iv-a/invite");
    expect(second.body.url).not.toBe(first.body.url);
    expect(rows[0].inviteTokenHash).not.toBe(hashInviteSecret(secret));
  });

  it("is only for the owner", async () => {
    expect((await as(bob).post("/api/interviews/iv-a/invite")).status).toBe(404);
  });
});

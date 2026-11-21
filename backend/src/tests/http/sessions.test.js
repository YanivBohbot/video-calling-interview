import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../helpers/testApp.js";

let prisma;
let app;

beforeEach(() => {
  prisma = { session: { findMany: vi.fn(), findUnique: vi.fn() } };
  ({ app } = buildTestApp({ prisma }));
});

describe("GET /api/sessions", () => {
  it("lists sessions in Mongo shape, ordered by difficulty then creation", async () => {
    prisma.session.findMany.mockResolvedValue([{ id: "s1", problem: "Two Sum", difficulty: "easy" }]);
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ _id: "s1", problem: "Two Sum", difficulty: "easy" }]);
    expect(prisma.session.findMany).toHaveBeenCalledWith({
      orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }],
    });
  });

  it("hides database failures behind the historical message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.session.findMany.mockRejectedValue(new Error("connection refused 127.0.0.1:5436"));
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Fetch sessions failed" });
  });
});

describe("GET /api/sessions/:id", () => {
  it("returns one session", async () => {
    prisma.session.findUnique.mockResolvedValue({ id: "s1", problem: "Two Sum" });
    const res = await request(app).get("/api/sessions/s1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ _id: "s1", problem: "Two Sum" });
    expect(prisma.session.findUnique).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("answers 404 for an unknown session", async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/api/sessions/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Session not found" });
  });

  it("answers 500 Fetch session failed on a database error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.session.findUnique.mockRejectedValue(new Error("boom"));
    const res = await request(app).get("/api/sessions/s1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Fetch session failed" });
  });
});

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "./app.js";

const container = (extra = {}) => ({ config: { clientUrl: "http://localhost:5174" }, routers: {}, ...extra });

describe("createApp", () => {
  it("answers /health with the historical body", async () => {
    const res = await request(createApp(container())).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: "success from backedn" });
  });

  it("no longer serves the dead /books route", async () => {
    const res = await request(createApp(container())).get("/books");
    expect(res.status).toBe(404);
  });

  it("answers unknown routes with a JSON 404", async () => {
    const res = await request(createApp(container())).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });

  it("mounts a module router under its API prefix", async () => {
    const sessions = express.Router().get("/", (req, res) => res.json(["module"]));
    const res = await request(createApp(container({ routers: { sessions } }))).get("/api/sessions");
    expect(res.body).toEqual(["module"]);
  });

  it("sends security headers and hides the framework", async () => {
    const res = await request(createApp(container())).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("rate-limits /api per client with a JSON 429", async () => {
    const sessions = express.Router().get("/", (req, res) => res.json([]));
    const app = createApp(container({ routers: { sessions } }), { apiRateLimit: { limit: 2, windowMs: 60_000 } });
    expect((await request(app).get("/api/sessions")).status).toBe(200);
    const second = await request(app).get("/api/sessions");
    expect(second.headers["ratelimit-limit"]).toBe("2");
    const third = await request(app).get("/api/sessions");
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ message: "Too many requests, please try again later" });
  });

  it("never rate-limits /health", async () => {
    const app = createApp(container(), { apiRateLimit: { limit: 1, windowMs: 60_000 } });
    for (let i = 0; i < 3; i++) expect((await request(app).get("/health")).status).toBe(200);
  });

  it("sends CORS headers for the configured client origin", async () => {
    const res = await request(createApp(container())).get("/health").set("Origin", "http://localhost:5174");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
  });
});

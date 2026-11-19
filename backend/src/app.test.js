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

  it("sends CORS headers for the configured client origin", async () => {
    const res = await request(createApp(container())).get("/health").set("Origin", "http://localhost:5174");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
  });
});

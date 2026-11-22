import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, authAs, PRINCIPALS } from "../helpers/testApp.js";
import { CodeRunnerUnavailableError } from "../../integrations/piston/client.js";

const { ada, demo, candidateOf } = PRINCIPALS;
const OK = { output: "2\n", stdout: "2\n", stderr: "", exitCode: 0, timedOut: false };

let codeRunner;
let app;

beforeEach(() => {
  codeRunner = { runCode: vi.fn().mockResolvedValue(OK) };
  ({ app } = buildTestApp({ codeRunner }));
});

const run = (principal, body) => request(app).post("/api/code/run").set(authAs(principal)).send(body);

describe("POST /api/code/run", () => {
  it("runs code for an interviewer", async () => {
    const res = await run(ada, { language: "python", code: "print(1+1)" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(OK);
    expect(codeRunner.runCode).toHaveBeenCalledWith({ language: "python", code: "print(1+1)", stdin: undefined });
  });

  it("lets a demo visitor and an invited candidate run code", async () => {
    expect((await run(demo, { language: "javascript", code: "1" })).status).toBe(200);
    expect((await run(candidateOf("iv-1"), { language: "java", code: "x" })).status).toBe(200);
  });

  it("rejects an unknown language with 400", async () => {
    const res = await run(ada, { language: "ruby", code: "puts 1" });
    expect(res.status).toBe(400);
    expect(codeRunner.runCode).not.toHaveBeenCalled();
  });

  it("rejects code over 50000 characters with 400", async () => {
    const res = await run(ada, { language: "python", code: "x".repeat(50001) });
    expect(res.status).toBe(400);
    expect(codeRunner.runCode).not.toHaveBeenCalled();
  });

  it("answers 502 'Code runner unavailable' when Piston is down", async () => {
    codeRunner.runCode.mockRejectedValue(new CodeRunnerUnavailableError("down"));
    const res = await run(ada, { language: "python", code: "" });
    expect(res.status).toBe(502);
    expect(res.body.message).toBe("Code runner unavailable");
  });

  it("limits each caller to 30 runs per minute", async () => {
    for (let i = 0; i < 30; i++) expect((await run(ada, { language: "python", code: "" })).status).toBe(200);
    const blocked = await run(ada, { language: "python", code: "" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
    // Another caller has their own budget.
    expect((await run(candidateOf("iv-1"), { language: "python", code: "" })).status).toBe(200);
  });

  it("gives each practice link its own budget (not one shared bucket)", async () => {
    const practiceOf = (interviewId) => ({ kind: "practice", interviewId });
    for (let i = 0; i < 30; i++) expect((await run(practiceOf("iv-1"), { language: "python", code: "" })).status).toBe(200);
    expect((await run(practiceOf("iv-1"), { language: "python", code: "" })).status).toBe(429);
    expect((await run(practiceOf("iv-2"), { language: "python", code: "" })).status).toBe(200);
  });

  it("needs a credential", async () => {
    expect((await run(null, { language: "python", code: "" })).status).toBe(401);
  });
});

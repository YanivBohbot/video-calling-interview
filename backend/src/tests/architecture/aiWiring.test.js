import { describe, it, expect, vi } from "vitest";
import { createContainer } from "../../container.js";
import { TEST_CONFIG } from "../helpers/testApp.js";
import { createInterviewRepository } from "../../repositories/interview.repository.js";

describe("AI wiring", () => {
  it("builds nothing AI-related until a generation is requested", () => {
    const searchProblems = vi.fn();
    const container = createContainer({ config: TEST_CONFIG, prisma: {}, leetcode: { searchProblems } });
    expect(container.ai.setup).toBeTypeOf("function");
    // No MCP child process any more: nothing to warm up or stop.
    expect(container.ai.warmUp).toBeUndefined();
    expect(container.ai.close).toBeUndefined();
    expect(searchProblems).not.toHaveBeenCalled();
  });

  it("saves approved questions through the interview repository", async () => {
    const update = vi.fn().mockResolvedValue({});
    await createInterviewRepository({ prisma: { interview: { update } } }).saveQuestions("iv-1", [{ text: "Q" }]);
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-1" }, data: { questions: [{ text: "Q" }] }, select: { id: true } });
  });

  it("agents never import Prisma or read process.env", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "../../ai");
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
    for (const f of files) {
      const code = fs.readFileSync(path.join(dir, f), "utf8");
      expect(code, f).not.toMatch(/lib\/db\.js|process\.env/);
    }
  });

  it("agents never import integrations/ (clients are injected by container.js)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "../../ai");
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const code = fs.readFileSync(path.join(dir, f), "utf8");
      expect(code, f).not.toMatch(/integrations\//);
    }
  });

  // Every .js file outside agents/ and the agents' own tests (tests/agents/ may reach internals).
  const backendFilesOutsideAgents = async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = path.resolve(import.meta.dirname, "../..");
    return fs
      .readdirSync(src, { recursive: true })
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => f.endsWith(".js") && !f.startsWith("ai/") && !f.startsWith("tests/ai/"))
      .map((f) => ({ f, code: fs.readFileSync(path.join(src, f), "utf8") }));
  };

  it.each(["workflows/questionGenerator", "agents/interviewer", "agents/coach"])(
    "the rest of the backend reaches %s only through its index.js",
    async (agent) => {
      for (const { f, code } of await backendFilesOutsideAgents()) {
        for (const [, target] of code.matchAll(new RegExp(`from "([^"]*ai/${agent}[^"]*)"`, "g"))) {
          expect(target, f).toMatch(new RegExp(`ai/${agent}/index[.]js$`));
        }
      }
    },
  );

  it("shared tools and middleware are used by agents only", async () => {
    for (const { f, code } of await backendFilesOutsideAgents()) {
      expect(code, f).not.toMatch(/from "[^"]*ai\/(tools|middleware|prompts)\//);
    }
  });

  it("each tool file defines one tool whose schema fields all have a .describe()", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "../../ai/tools");
    const files = fs
      .readdirSync(dir, { recursive: true })
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => f.endsWith(".js") && f !== "index.js");
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const code = fs.readFileSync(path.join(dir, f), "utf8");
      // The `tool(` call itself, not createRunCodeTool( and the like.
      expect(code.match(/(?<![\w.])tool\(/g)?.length, f).toBe(1);
      const fields = code.match(/^\s+(?!schema:)\w+: z\./gm)?.length ?? 0;
      const described = code.match(/\.describe\(/g)?.length ?? 0;
      expect(described, f).toBeGreaterThanOrEqual(fields);
    }
  });
});

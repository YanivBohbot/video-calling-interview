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

  // Every .js file under src/ (paths with "/" on every OS), with its code.
  const sourceFiles = async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = path.resolve(import.meta.dirname, "../..");
    return fs
      .readdirSync(src, { recursive: true })
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => ({ f, code: fs.readFileSync(path.join(src, f), "utf8") }));
  };
  const importsOf = (code) => [...code.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map(([, target]) => target);
  const aiFiles = async () => (await sourceFiles()).filter(({ f }) => f.startsWith("ai/"));
  // Outside ai/ and the AI tests (tests/ai/ may reach internals).
  const filesOutsideAi = async () =>
    (await sourceFiles()).filter(({ f }) => !f.startsWith("ai/") && !f.startsWith("tests/ai/"));

  it("nothing in ai/ imports Prisma or reads process.env", async () => {
    for (const { f, code } of await aiFiles()) expect(code, f).not.toMatch(/lib\/db\.js|process\.env/);
  });

  it("nothing in ai/ imports integrations/ (clients are injected by container.js)", async () => {
    for (const { f, code } of await aiFiles()) expect(code, f).not.toMatch(/integrations\//);
  });

  it.each(["agents/interviewer", "agents/coach", "workflows/questionGenerator"])(
    "the rest of the backend reaches ai/%s only through its index.js",
    async (unit) => {
      for (const { f, code } of await filesOutsideAi()) {
        for (const target of importsOf(code).filter((t) => t.includes(`ai/${unit}`))) {
          expect(target, f).toMatch(new RegExp(`ai/${unit}/index[.]js$`));
        }
      }
    },
  );

  it("outside code imports ai/ only through an agent or workflow index.js, or ai/checkpointer.js", async () => {
    for (const { f, code } of await filesOutsideAi()) {
      for (const target of importsOf(code).filter((t) => /(^|\/)ai\//.test(t))) {
        expect(target, f).toMatch(/ai\/(agents|workflows)\/[^/]+\/index\.js$|ai\/checkpointer\.js$/);
      }
    }
  });

  it("tools, prompts and middleware never import an agent or a workflow", async () => {
    const shared = (await aiFiles()).filter(({ f }) => /^ai\/(tools|prompts|middleware)\//.test(f));
    expect(shared.length).toBeGreaterThan(0);
    for (const { f, code } of shared) {
      for (const target of importsOf(code)) expect(target, f).not.toMatch(/(agents|workflows)\//);
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

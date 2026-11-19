import { describe, it, expect, vi } from "vitest";
import { createContainer } from "../container.js";
import { TEST_CONFIG } from "./testApp.js";
import { createInterviewRepository } from "../repositories/interview.repository.js";

describe("AI wiring", () => {
  it("builds nothing AI-related until a generation is requested", () => {
    const createClient = vi.fn();
    const container = createContainer({ config: TEST_CONFIG, prisma: {}, ai: { createMcpClient: createClient } });
    expect(container.ai).toBeDefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves approved questions through the interview repository", async () => {
    const update = vi.fn().mockResolvedValue({});
    await createInterviewRepository({ prisma: { interview: { update } } }).saveQuestions("iv-1", [{ text: "Q" }]);
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-1" }, data: { questions: [{ text: "Q" }] }, select: { id: true } });
  });

  it("agents never import Prisma or read process.env", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "../agents");
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
    for (const f of files) {
      const code = fs.readFileSync(path.join(dir, f), "utf8");
      expect(code, f).not.toMatch(/lib\/db\.js|process\.env/);
    }
  });
});

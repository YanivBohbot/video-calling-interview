import { describe, it, expect } from "vitest";
import { createCheckpointer } from "../../../../agents/questionGenerator/execution/checkpointer.js";

describe("checkpointer", () => {
  it("keeps its tables out of the Prisma-managed public schema", () => {
    expect(createCheckpointer({ connectionString: "postgres://u:p@localhost:1/db" }).options.schema).toBe("langgraph");
  });
});

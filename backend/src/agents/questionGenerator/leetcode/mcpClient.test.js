import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLeetCodeTools, LEETCODE_MCP_PACKAGE } from "./mcpClient.js";

const healthyClient = (tools) => ({ getTools: vi.fn().mockResolvedValue(tools), close: vi.fn().mockResolvedValue() });
const failingClient = (message) => ({ getTools: vi.fn().mockRejectedValue(new Error(message)), close: vi.fn().mockResolvedValue() });

describe("LeetCode MCP tools", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("pins the MCP server version (no unpinned runtime download)", () => {
    expect(LEETCODE_MCP_PACKAGE).toMatch(/^@jinzcdev\/leetcode-mcp-server@\d+\.\d+\.\d+$/);
  });

  it("filters the server's tools down to the allowlist", async () => {
    const client = healthyClient([
      { name: "get_daily_challenge" },
      { name: "search_problems" },
      { name: "get_problem" },
      { name: "get_user_profile" }, // not allowlisted — requires nothing we want to expose
      { name: "get_all_submissions" }, // not allowlisted — auth-required
    ]);
    const tools = await createLeetCodeTools({ createClient: () => client }).getTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_daily_challenge", "get_problem", "search_problems"]);
  });

  it("returns an empty array without throwing when the connection fails", async () => {
    const leetcode = createLeetCodeTools({ createClient: () => failingClient("spawn ENOENT") });
    await expect(leetcode.getTools()).resolves.toEqual([]);
  });

  it("memoizes the result — only fetches tools once across multiple calls", async () => {
    const client = healthyClient([{ name: "search_problems" }]);
    const leetcode = createLeetCodeTools({ createClient: () => client });
    await leetcode.getTools();
    await leetcode.getTools();
    expect(client.getTools).toHaveBeenCalledOnce();
  });

  it("does not cache a failed connection — the next call retries with a fresh client", async () => {
    const healthy = healthyClient([{ name: "get_problem" }, { name: "get_user_profile" }]);
    const createClient = vi.fn().mockReturnValueOnce(failingClient("npx download timed out")).mockReturnValueOnce(healthy);
    const leetcode = createLeetCodeTools({ createClient });
    await expect(leetcode.getTools()).resolves.toEqual([]);
    expect((await leetcode.getTools()).map((t) => t.name)).toEqual(["get_problem"]);
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure even when the client throws synchronously", async () => {
    const throwing = { getTools: vi.fn(() => { throw new Error("spawn npx ENOENT"); }), close: vi.fn() };
    const createClient = vi.fn().mockReturnValueOnce(throwing).mockReturnValueOnce(healthyClient([{ name: "search_problems" }]));
    const leetcode = createLeetCodeTools({ createClient });
    await expect(leetcode.getTools()).resolves.toEqual([]);
    expect((await leetcode.getTools()).map((t) => t.name)).toEqual(["search_problems"]);
  });

  it("closes the MCP client (stops the child process) on shutdown", async () => {
    const client = healthyClient([{ name: "search_problems" }]);
    const leetcode = createLeetCodeTools({ createClient: () => client });
    await leetcode.getTools();
    await leetcode.close();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("close() is a no-op when nothing was started", async () => {
    await expect(createLeetCodeTools({ createClient: vi.fn() }).close()).resolves.toBeUndefined();
  });

  it("logs the names of the tools that loaded", async () => {
    const client = healthyClient([{ name: "search_problems" }, { name: "get_user_profile" }]);
    await createLeetCodeTools({ createClient: () => client }).getTools();
    expect(console.log).toHaveBeenCalledWith("leetcodeMcpClient: loaded tools:", ["search_problems"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLeetCodeTools, _resetLeetCodeToolsCache } from "./leetcodeMcpClient.js";

const makeMockClient = (tools) => ({
  getTools: vi.fn().mockResolvedValue(tools),
});

const makeFailingClient = (message) => ({
  getTools: vi.fn().mockRejectedValue(new Error(message)),
});

describe("getLeetCodeTools", () => {
  beforeEach(() => {
    _resetLeetCodeToolsCache();
  });

  it("filters the server's tools down to the allowlist", async () => {
    const client = makeMockClient([
      { name: "get_daily_challenge" },
      { name: "search_problems" },
      { name: "get_problem" },
      { name: "get_user_profile" }, // not allowlisted — requires nothing we want to expose
      { name: "get_all_submissions" }, // not allowlisted — auth-required
    ]);

    const tools = await getLeetCodeTools({ client });

    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_daily_challenge",
      "get_problem",
      "search_problems",
    ]);
  });

  it("returns an empty array without throwing when the connection fails", async () => {
    const client = makeFailingClient("spawn ENOENT");
    await expect(getLeetCodeTools({ client })).resolves.toEqual([]);
  });

  it("memoizes the result — only fetches tools once across multiple calls", async () => {
    const client = makeMockClient([{ name: "search_problems" }]);

    await getLeetCodeTools({ client });
    await getLeetCodeTools({ client });

    expect(client.getTools).toHaveBeenCalledOnce();
  });
});

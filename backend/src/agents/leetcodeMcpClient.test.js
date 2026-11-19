import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("does not cache a failed connection — the next call retries and can succeed", async () => {
    const failing = makeFailingClient("npx download timed out");
    await expect(getLeetCodeTools({ client: failing })).resolves.toEqual([]);

    const healthy = makeMockClient([{ name: "get_problem" }, { name: "get_user_profile" }]);
    const tools = await getLeetCodeTools({ client: healthy });

    expect(healthy.getTools).toHaveBeenCalledOnce();
    expect(tools.map((t) => t.name)).toEqual(["get_problem"]);
  });

  it("does not cache a failure even when the client throws synchronously", async () => {
    const throwing = {
      getTools: vi.fn(() => {
        throw new Error("spawn npx ENOENT");
      }),
    };
    await expect(getLeetCodeTools({ client: throwing })).resolves.toEqual([]);

    const healthy = makeMockClient([{ name: "search_problems" }]);
    const tools = await getLeetCodeTools({ client: healthy });

    expect(tools.map((t) => t.name)).toEqual(["search_problems"]);
  });

  it("logs the names of the tools that loaded", async () => {
    const client = makeMockClient([{ name: "search_problems" }, { name: "get_user_profile" }]);

    await getLeetCodeTools({ client });

    expect(console.log).toHaveBeenCalledWith("leetcodeMcpClient: loaded tools:", [
      "search_problems",
    ]);
  });
});

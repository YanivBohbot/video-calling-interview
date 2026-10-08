import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const ALLOWED_TOOL_NAMES = new Set(["get_daily_challenge", "get_problem", "search_problems"]);

const buildDefaultClient = () =>
  new MultiServerMCPClient({
    leetcode: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@jinzcdev/leetcode-mcp-server", "--site", "global"],
    },
  });

let cachedToolsPromise = null;

export const getLeetCodeTools = async ({ client } = {}) => {
  if (cachedToolsPromise) return cachedToolsPromise;

  const attempt = (async () => {
    try {
      const mcpClient = client || buildDefaultClient();
      const tools = (await mcpClient.getTools()).filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
      console.log("leetcodeMcpClient: loaded tools:", tools.map((t) => t.name));
      return tools;
    } catch (err) {
      console.error(
        "leetcodeMcpClient: failed to connect, continuing without LeetCode tools:",
        err.message,
      );
      return null;
    }
  })();

  // Don't memoize failures: a transient cold-start error (e.g. the npx download timing
  // out) must not disable LeetCode grounding for the rest of the process. The reset runs
  // in .then() so it always lands after the assignment, even if the attempt failed synchronously.
  cachedToolsPromise = attempt.then((tools) => {
    if (tools) return tools;
    cachedToolsPromise = null;
    return [];
  });

  return cachedToolsPromise;
};

// Test-only: clears the memoized connection so each test starts fresh.
export const _resetLeetCodeToolsCache = () => {
  cachedToolsPromise = null;
};

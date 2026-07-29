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

  cachedToolsPromise = (async () => {
    try {
      const mcpClient = client || buildDefaultClient();
      const tools = await mcpClient.getTools();
      return tools.filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
    } catch (err) {
      console.error(
        "leetcodeMcpClient: failed to connect, continuing without LeetCode tools:",
        err.message,
      );
      return [];
    }
  })();

  return cachedToolsPromise;
};

// Test-only: clears the memoized connection so each test starts fresh.
export const _resetLeetCodeToolsCache = () => {
  cachedToolsPromise = null;
};

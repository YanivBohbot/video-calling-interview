import { MultiServerMCPClient } from "@langchain/mcp-adapters";

// The LeetCode MCP server, through the official @langchain/mcp-adapters client.

// Pinned (1.5.1 = the version verified working; 1.4.0 no longer starts — a dependency moved).
// The MCP server is downloaded by npx at runtime, so an unpinned name would run
// whatever was published last. Bump deliberately (and re-check the tool output format).
export const LEETCODE_MCP_PACKAGE = "@jinzcdev/leetcode-mcp-server@1.5.1";

const ALLOWED_TOOL_NAMES = new Set(["get_daily_challenge", "get_problem", "search_problems"]);

const createDefaultClient = () =>
  new MultiServerMCPClient({
    leetcode: {
      transport: "stdio",
      command: "npx",
      args: ["-y", LEETCODE_MCP_PACKAGE, "--site", "global"],
    },
  });

// LeetCode MCP tools, connected once and shared. A failed connection is not memoised
// (a transient cold-start error, e.g. the npx download timing out, must not disable
// grounding until restart): the next call retries with a fresh client.
// getTools() never rejects — it resolves to [] when the server is unreachable.
export const createLeetCodeTools = ({ createClient = createDefaultClient } = {}) => {
  let client = null;
  let toolsPromise = null;

  const connect = async () => {
    try {
      client = createClient();
      const tools = (await client.getTools()).filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
      console.log("leetcodeMcpClient: loaded tools:", tools.map((t) => t.name));
      return tools;
    } catch (err) {
      console.error("leetcodeMcpClient: failed to connect, continuing without LeetCode tools:", err.message);
      return null;
    }
  };

  const getTools = () => {
    if (!toolsPromise) {
      // The reset runs in .then() so it always lands after the assignment.
      toolsPromise = connect().then((tools) => {
        if (tools) return tools;
        toolsPromise = null;
        return [];
      });
    }
    return toolsPromise;
  };

  // Stops the stdio child process (graceful shutdown).
  const close = async () => {
    const current = client;
    client = null;
    toolsPromise = null;
    if (current) await current.close().catch(() => {});
  };

  return { getTools, close };
};

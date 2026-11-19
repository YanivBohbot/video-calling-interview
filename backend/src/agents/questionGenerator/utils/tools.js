import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { parseSearchProblems } from "./sources.js";

// The graph's tools (the doc's utils/tools): the LeetCode MCP server, through the
// official @langchain/mcp-adapters client, and the one search the researcher runs.

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

// Runs the LeetCode MCP `search_problems` tool directly (code, not the model, calls it:
// an agent tool loop ignored offsets and hit its step limit) and parses its JSON.
export const createSearchProblems = ({ getTools }) => async ({ tags, ...params }) => {
  const search = (await getTools()).find((t) => t.name === "search_problems");
  if (!search) throw new Error("LeetCode search_problems tool unavailable");
  const raw = await search.invoke(tags?.length ? { ...params, tags } : params);
  return parseSearchProblems(raw);
};

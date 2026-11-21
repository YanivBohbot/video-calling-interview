import { parseSearchProblems } from "./sources.js";

// Runs the LeetCode MCP `search_problems` tool directly (code, not the model, calls it:
// an agent tool loop ignored offsets and hit its step limit) and parses its JSON.
export const createSearchProblems = ({ getTools }) => async ({ tags, ...params }) => {
  const search = (await getTools()).find((t) => t.name === "search_problems");
  if (!search) throw new Error("LeetCode search_problems tool unavailable");
  const raw = await search.invoke(tags?.length ? { ...params, tags } : params);
  return parseSearchProblems(raw);
};

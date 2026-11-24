import { tool } from "langchain";
import { z } from "zod";

const SHOWN = 5;
const FAILED = "LeetCode search failed; invent a classic problem instead.";

// find_problem: real LeetCode problems to draw on (title, difficulty, link — never the
// statement, which is LeetCode's). `searchProblems` is the injected LeetCode client.
// A random offset keeps sessions from always getting the same problem.
export const createFindProblemTool = ({ searchProblems, randomOffset = () => Math.floor(Math.random() * 50) }) =>
  tool(
    async ({ difficulty, tags }) => {
      let problems;
      try {
        problems = await searchProblems({ category: "algorithms", tags, difficulty, offset: randomOffset(), limit: 10 });
      } catch {
        return FAILED;
      }
      return JSON.stringify(
        problems.slice(0, SHOWN).map(({ slug, title, difficulty: level }) => ({
          title,
          difficulty: level,
          url: `https://leetcode.com/problems/${slug}/`,
        })),
      );
    },
    {
      name: "find_problem",
      description:
        "Find real LeetCode problems to base the exercise on, at the start of a session. " +
        "Returns titles and links only: write your own statement inspired by one, and cite its title and link.",
      schema: z.object({
        difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).describe("Problem difficulty, matched to the candidate's level"),
        tags: z
          .array(z.string())
          .max(3)
          .default([])
          .describe("LeetCode topic slugs, e.g. array, hash-table, dynamic-programming"),
      }),
    },
  );

import { describe, it, expect, vi } from "vitest";
import { createLeetCodeClient } from "../../../integrations/leetcode/client.js";

const fakeFetch = (status, body) => vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
const page = (questions) => ({ data: { problemsetQuestionList: { total: questions.length, questions } } });

describe("LeetCode client", () => {
  it("maps the filters to GraphQL variables", async () => {
    const fetch = fakeFetch(200, page([]));
    await createLeetCodeClient({ fetch }).searchProblems({
      category: "algorithms", tags: ["hash-table"], difficulty: "MEDIUM", offset: 5, limit: 9,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://leetcode.com/graphql");
    expect(init.headers.Referer).toBe("https://leetcode.com/problemset/");
    expect(JSON.parse(init.body).variables).toEqual({
      categorySlug: "algorithms", skip: 5, limit: 9, filters: { difficulty: "MEDIUM", tags: ["hash-table"] },
    });
  });

  it("omits empty tags", async () => {
    const fetch = fakeFetch(200, page([]));
    await createLeetCodeClient({ fetch }).searchProblems({ category: "algorithms", tags: [], difficulty: "EASY" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).variables.filters).toEqual({ difficulty: "EASY" });
  });

  it("returns slug, title and difficulty and drops paid-only problems", async () => {
    const fetch = fakeFetch(200, page([
      { title: "Two Sum", titleSlug: "two-sum", difficulty: "Easy", paidOnly: false },
      { title: "Locked", titleSlug: "locked", difficulty: "Hard", paidOnly: true },
    ]));
    expect(await createLeetCodeClient({ fetch }).searchProblems({ category: "algorithms", difficulty: "EASY" })).toEqual([
      { slug: "two-sum", title: "Two Sum", difficulty: "Easy" },
    ]);
  });

  it("throws on a non-2xx or non-JSON answer (e.g. a Cloudflare page)", async () => {
    const html = vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => { throw new SyntaxError("Unexpected token <"); },
    });
    await expect(
      createLeetCodeClient({ fetch: html }).searchProblems({ category: "algorithms", difficulty: "EASY" }),
    ).rejects.toThrow(/leetcode/i);
  });

  it("throws on GraphQL errors", async () => {
    const fetch = fakeFetch(200, { errors: [{ message: "bad filter" }] });
    await expect(
      createLeetCodeClient({ fetch }).searchProblems({ category: "algorithms", difficulty: "EASY" }),
    ).rejects.toThrow(/leetcode/i);
  });
});

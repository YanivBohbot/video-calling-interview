// Searches LeetCode problems through leetcode.com's GraphQL API (the one its problem list
// page uses — LeetCode has no official public API, so this can break if they change it).
// Only titles, slugs and difficulties are read: problem statements are never fetched.

const SEARCH_QUERY = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data { title titleSlug difficulty paidOnly: isPaidOnly }
  }
}`;

const fail = (reason, cause) => new Error(`LeetCode search failed: ${reason}`, cause ? { cause } : undefined);

export const createLeetCodeClient = ({
  fetch = globalThis.fetch,
  endpoint = "https://leetcode.com/graphql",
  timeoutMs = 10000,
} = {}) => {
  // ({ category, tags, difficulty, offset, limit }) → [{ slug, title, difficulty }], free problems only.
  const searchProblems = async ({ category, tags = [], difficulty, offset = 0, limit = 20 }) => {
    const filters = tags.length ? { difficulty, tags } : { difficulty };
    let res;
    let body;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: "https://leetcode.com/problemset/" },
        body: JSON.stringify({ query: SEARCH_QUERY, variables: { categorySlug: category, skip: offset, limit, filters } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw fail(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      throw err.message?.startsWith("LeetCode search failed") ? err : fail("no valid answer", err);
    }
    if (body?.errors?.length) throw fail("GraphQL error");
    const questions = body?.data?.problemsetQuestionList?.questions;
    if (!Array.isArray(questions)) throw fail("unexpected answer");
    return questions
      .filter((q) => !q.paidOnly && typeof q.titleSlug === "string" && typeof q.title === "string")
      .map((q) => ({ slug: q.titleSlug, title: q.title, difficulty: q.difficulty ?? "Unknown" }));
  };

  return { searchProblems };
};

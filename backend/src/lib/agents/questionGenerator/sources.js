export const leetcodeUrl = (slug) => `https://leetcode.com/problems/${slug}/`;

// The search_problems tool returns a JSON string; research facts (title, difficulty)
// come only from here, never from model output.
export const parseSearchProblems = (raw) => {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const questions = data?.problems?.questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .filter((q) => typeof q?.titleSlug === "string" && typeof q?.title === "string")
    .map((q) => ({
      slug: q.titleSlug,
      title: q.title,
      difficulty: typeof q.difficulty === "string" ? q.difficulty : "Unknown",
    }));
};

// The model only names a slug; title, difficulty and URL come from the search result
// and from code, and only technical questions may carry a source.
export const attachSources = (drafts, research) => {
  const bySlug = new Map(research.map((p) => [p.slug, p]));
  return drafts.map(({ sourceSlug, ...question }) => {
    const problem = question.category === "technical" && sourceSlug ? bySlug.get(sourceSlug) : undefined;
    if (!problem) return question;
    return {
      ...question,
      source: {
        type: "leetcode",
        title: problem.title,
        slug: problem.slug,
        difficulty: problem.difficulty,
        url: leetcodeUrl(problem.slug),
      },
    };
  });
};

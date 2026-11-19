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
// and from code. Only technical questions may carry a source, and each problem is
// credited once — a reused slug is dropped rather than failing the run.
export const attachSources = (drafts, research) => {
  const bySlug = new Map(research.map((p) => [p.slug, p]));
  const used = new Set();
  return drafts.map(({ sourceSlug, ...question }) => {
    const problem =
      question.category === "technical" && sourceSlug && !used.has(sourceSlug) ? bySlug.get(sourceSlug) : undefined;
    if (!problem) return question;
    used.add(problem.slug);
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

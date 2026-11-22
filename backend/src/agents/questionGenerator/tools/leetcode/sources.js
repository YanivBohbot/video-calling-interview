export const leetcodeUrl = (slug) => `https://leetcode.com/problems/${slug}/`;

// The model only names a slug; title, difficulty and URL come from the search result
// (the injected searchProblems) and from code, never from model output. Only technical questions may carry a source, and each problem is
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

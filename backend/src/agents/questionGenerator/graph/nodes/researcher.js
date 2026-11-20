// LLM + tool step: find real LeetCode problems to ground the technical questions.
// Dependencies (runtime.context): chooseSearch (llm/models.js), searchProblems (leetcode/search.js).

const dedupeBySlug = (problems) => [...new Map(problems.map((p) => [p.slug, p])).values()];

// Partial Fisher-Yates: n distinct picks, driven by the injected random source.
const sample = (items, n, random) => {
  const pool = [...items];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
};

// The model only chooses search filters; code runs the search. An agent tool loop
// here ignored the offset, repeated generic problems and hit the step limit.
// Grounding stays optional: any failure degrades to no research.
export const researcherNode = async (state, runtime) => {
  const { chooseSearch, searchProblems, random = Math.random } = runtime.context;
  const technicalCount = state.plan.categoryCounts.technical || 0;
  if (!technicalCount) return { research: [] };
  try {
    const query = await chooseSearch({ role: state.role, interviewType: state.interviewType });
    const limit = technicalCount * 3;
    // Small enough that even narrow filter sets (~30 problems) still return results.
    const offset = Math.floor(random() * 21);
    // Each step is broader; results accumulate until there's one problem per technical
    // question, because narrow filters can match only one or two problems.
    const attempts = [
      { ...query, offset },
      { ...query, offset: 0 },
      { category: query.category, difficulty: query.difficulty, offset },
      { category: "algorithms", difficulty: query.difficulty, offset },
    ];
    let found = [];
    for (const params of attempts) {
      found = dedupeBySlug([...found, ...(await searchProblems({ ...params, limit }))]);
      if (found.length >= technicalCount) break;
    }
    return { research: sample(found, technicalCount, random) };
  } catch (err) {
    console.warn("question generator: researcher failed, continuing without grounding:", err.message);
    return { research: [] };
  }
};

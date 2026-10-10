// Largest-remainder apportionment: floors each share, then hands the leftover
// slots to the largest fractional parts so the result always sums to `count`.
// Fractions are rounded so float noise (0.6000000000000001 vs 0.5999999999999996)
// can't break real ties; the stable sort then favors earlier-declared categories.
export const distributeCounts = (count, weights) => {
  const categories = Object.keys(weights);
  const raw = categories.map((c) => count * weights[c]);
  const base = raw.map((r) => Math.floor(r + 1e-9));
  const assigned = base.reduce((a, b) => a + b, 0);
  const remaining = count - assigned;
  const remainders = raw.map((r, i) => ({ i, frac: Math.round((r - base[i]) * 1e6) / 1e6 }));
  remainders.sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remaining; k++) base[remainders[k].i] += 1;
  return Object.fromEntries(categories.map((c, i) => [c, base[i]]));
};

const PLANNER_WEIGHTS = {
  technical: { technical: 0.6, behavioral: 0.25, "system-design": 0.15 },
  behavioral: { behavioral: 0.6, technical: 0.3, "system-design": 0.1 },
  "system-design": { "system-design": 0.6, technical: 0.3, behavioral: 0.1 },
};

export const makePlannerNode = () => async (state) => {
  const weights = PLANNER_WEIGHTS[state.interviewType] || PLANNER_WEIGHTS.technical;
  return { plan: { categoryCounts: distributeCounts(state.count, weights) } };
};

// Grounding is optional: an unreachable LeetCode MCP server must degrade to no
// research, never fail the whole generation.
export const makeResearcherNode = ({ buildResearcherAgent }) => async (state) => {
  if (!state.plan.categoryCounts.technical) return { research: [] };
  try {
    const agent = await buildResearcherAgent();
    const result = await agent.invoke({
      messages: [{ role: "user", content: `Role: ${state.role}\nInterview type: ${state.interviewType}` }],
    });
    const { usedLeetCode, notes } = result.structuredResponse;
    return { research: usedLeetCode ? [notes] : [] };
  } catch {
    return { research: [] };
  }
};

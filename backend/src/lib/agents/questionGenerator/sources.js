import { ToolMessage } from "@langchain/core/messages";

export const leetcodeUrl = (slug) => `https://leetcode.com/problems/${slug}/`;

const contentText = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("");
  return "";
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const walk = (node, found) => {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, found));
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.titleSlug === "string" && typeof node.title === "string" && !found.has(node.titleSlug)) {
    found.set(node.titleSlug, {
      slug: node.titleSlug,
      title: node.title,
      difficulty: typeof node.difficulty === "string" ? node.difficulty : "Unknown",
    });
  }
  Object.values(node).forEach((v) => walk(v, found));
};

// Only problems a LeetCode tool actually returned this run may be cited, so a
// slug the model invents can never become a badge or a link.
export const collectSeenProblems = (messages = []) => {
  const found = new Map();
  for (const m of messages) {
    if (ToolMessage.isInstance(m)) walk(parseJson(contentText(m.content)), found);
  }
  return found;
};

export const pickResearchProblems = (chosen, seen, max) => {
  const picked = [];
  for (const { slug } of chosen ?? []) {
    if (picked.length >= max) break;
    const problem = seen.get(slug);
    if (problem && !picked.some((p) => p.slug === slug)) picked.push(problem);
  }
  return picked;
};

// The model only names a slug; title, difficulty and URL come from the tool result
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

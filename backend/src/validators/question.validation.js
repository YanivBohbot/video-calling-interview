import { leetcodeUrl } from "../agents/questionGenerator/index.js";

const ALLOWED_QUESTION_CATEGORY = new Set(["technical", "behavioral", "system-design"]);
const ALLOWED_QUESTION_DIFFICULTY = new Set(["easy", "medium", "hard"]);

const LEETCODE_SLUG = /^[a-z0-9-]+$/;

// A source is rendered as a link, so only a canonical LeetCode problem URL derived
// from a safe slug is accepted — never an arbitrary client-supplied href.
const isValidSource = (s) =>
  !!s &&
  s.type === "leetcode" &&
  typeof s.title === "string" &&
  !!s.title.trim() &&
  typeof s.difficulty === "string" &&
  typeof s.slug === "string" &&
  LEETCODE_SLUG.test(s.slug) &&
  s.url === leetcodeUrl(s.slug);

// Returns the first problem as a client-facing message, or null when the payload is valid.
export const validateQuestionsPayload = (questions) => {
  if (!Array.isArray(questions)) return "questions must be an array";
  for (const q of questions) {
    if (typeof q?.text !== "string" || !q.text.trim()) return "each question needs non-empty text";
    if (!ALLOWED_QUESTION_CATEGORY.has(q.category)) return `invalid category: ${q.category}`;
    if (!ALLOWED_QUESTION_DIFFICULTY.has(q.difficulty)) return `invalid difficulty: ${q.difficulty}`;
    if (q.source !== undefined && !isValidSource(q.source)) return "invalid question source";
  }
  return null;
};

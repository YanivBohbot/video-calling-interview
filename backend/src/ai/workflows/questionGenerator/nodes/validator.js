import { Command } from "@langchain/langgraph";
import { AIInvalidResponseError } from "../errors.js";

// Routing step: accept the draft, send it back to the drafter, or switch to the fallback model.

const MAX_CONTENT_RETRIES = 2;

const validateContent = (state) => {
  const errors = [];
  if (state.draftQuestions.length !== state.count) {
    errors.push(`expected ${state.count} questions, got ${state.draftQuestions.length}`);
  }
  const seen = new Set();
  for (const q of state.draftQuestions) {
    if (!q.text || !q.text.trim()) errors.push("empty question text");
    const key = q.text.trim().toLowerCase();
    if (seen.has(key)) errors.push(`duplicate question: "${q.text}"`);
    seen.add(key);
  }
  return errors;
};

// Soft: worth a retry, but an interviewer can re-categorise at approval.
const validateMix = (state) => {
  if (!state.plan) return [];
  return Object.entries(state.plan.categoryCounts)
    .map(([category, expected]) => [category, expected, state.draftQuestions.filter((q) => q.category === category).length])
    .filter(([, expected, actual]) => actual !== expected)
    .map(([category, expected, actual]) => `expected ${expected} ${category} questions, got ${actual}`);
};

// Content failures loop back to the drafter; once those retries are spent the
// fallback model gets exactly one pass. After that a broken draft bubbles up,
// while one whose only problem is the category mix goes to the human.
export const validatorNode = async (state) => {
  const hardErrors = validateContent(state);
  const errors = [...hardErrors, ...validateMix(state)];
  if (errors.length === 0) {
    return new Command({ update: { validationErrors: [] }, goto: "humanApproval" });
  }
  if (state.retryCount < MAX_CONTENT_RETRIES) {
    return new Command({
      update: { validationErrors: errors, retryCount: state.retryCount + 1 },
      goto: "drafter",
    });
  }
  if (!state.useFallbackModel) {
    return new Command({ update: { validationErrors: errors }, goto: "fallback" });
  }
  if (hardErrors.length === 0) {
    return new Command({ update: { validationErrors: errors }, goto: "humanApproval" });
  }
  throw new AIInvalidResponseError(`Validation failed after fallback: ${errors.join("; ")}`);
};

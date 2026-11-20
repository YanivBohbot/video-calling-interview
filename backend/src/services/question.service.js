import {
  AIConfigError,
  AIInvalidResponseError,
  AIProviderError,
  UnknownJobError,
} from "../agents/questionGenerator/index.js";
import { AppError, NotFoundError, RateLimitError, UpstreamError, ValidationError } from "../shared/errors.js";
import { validateQuestionsPayload } from "../validators/question.validation.js";
import { DEMO } from "../auth/principal.js";

// Generation errors: config problems are shown, provider failures are a 502.
const toGenerateError = (err) => {
  if (err instanceof AIConfigError) return new AppError(500, "AI is not configured correctly", {}, { cause: err });
  if (err instanceof AIProviderError || err instanceof AIInvalidResponseError) {
    return new UpstreamError("AI service unavailable", { cause: err });
  }
  return err;
};

// Approval errors: only an unknown/resolved job is meaningful to the client; any other
// failure stays unexpected (500 "Failed to resolve approval"), as it always has.
const toApproveError = (err) =>
  err instanceof UnknownJobError ? new NotFoundError("No pending approval for this job") : err;

// AI question generation with a human approval step.
// `generation` is { start, resume } from the LangGraph pipeline (injected, so tests fake it).
// Only the interview's owner may generate or approve. Interviewers are limited per user;
// all demo visitors share one, tighter budget (the demo is public).
export const createQuestionService = ({ interviewRepository, generation, rateLimiter, demoRateLimiter, config }) => {
  const getOwned = async (principal, interviewId) => {
    const interview = await interviewRepository.findById(interviewId);
    if (!interview || interview.interviewerId !== principal.userId) throw new NotFoundError("Interview not found");
    return interview;
  };

  const checkBudget = (principal) =>
    principal.kind === DEMO ? demoRateLimiter.check("demo") : rateLimiter.check(principal.userId);

  const generate = async (principal, interviewId) => {
    const interview = await getOwned(principal, interviewId);

    // Only OpenAI models need this key; other providers read their own (e.g. ANTHROPIC_API_KEY).
    const usesOpenAi = !config.aiModel || config.aiModel.startsWith("openai:");
    if (usesOpenAi && !config.openaiApiKey) throw new AppError(500, "AI not configured: OPENAI_API_KEY missing");

    const gate = checkBudget(principal);
    if (!gate.ok) throw new RateLimitError("Too many AI generations, slow down", gate.retryAfter);

    try {
      const { jobId, draftQuestions, plan } = await generation.start({
        interviewId: interview.id,
        role: interview.role,
        interviewType: interview.interviewType,
        count: config.aiQuestionCount,
      });
      return { jobId, status: "pending_approval", draftQuestions, plan };
    } catch (err) {
      throw toGenerateError(err);
    }
  };

  // Resolves a paused draft. The thread is always addressed by the interview in the URL,
  // so a jobId minted for another interview resolves to nothing (404) — never to that interview.
  const approve = async (principal, interviewId, { jobId, approved, questions } = {}) => {
    if (typeof jobId !== "string" || typeof approved !== "boolean") {
      throw new ValidationError("jobId (string) and approved (boolean) are required");
    }
    await getOwned(principal, interviewId);
    // Validate before resuming: a payload rejected inside the graph would error the
    // paused thread and make the draft permanently un-approvable.
    if (approved && questions !== undefined) {
      const problem = validateQuestionsPayload(questions);
      if (problem) throw new ValidationError(problem);
    }

    let result;
    try {
      result = await generation.resume({
        interviewId,
        jobId,
        approved,
        questions: approved ? questions : undefined,
      });
    } catch (err) {
      throw toApproveError(err);
    }
    if (!result.approved) return { status: "rejected" };

    const updated = await interviewRepository.findByIdWithInterviewer(interviewId);
    if (!updated) throw new NotFoundError("Interview not found");
    return { status: "approved", interview: updated };
  };

  return { generate, approve };
};

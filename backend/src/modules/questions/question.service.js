import {
  AIConfigError,
  AIInvalidResponseError,
  AIProviderError,
  UnknownJobError,
} from "../../agents/questionGenerator/errors.js";
import { AppError, NotFoundError, RateLimitError, UpstreamError, ValidationError } from "../../shared/errors.js";
import { validateQuestionsPayload } from "./question.validation.js";

// Maps the agent pipeline's errors onto API errors; anything else stays unexpected.
const toApiError = (err) => {
  if (err instanceof AIConfigError) return new AppError(500, err.message);
  if (err instanceof AIProviderError || err instanceof AIInvalidResponseError) {
    return new UpstreamError("AI service unavailable", { cause: err });
  }
  if (err instanceof UnknownJobError) return new NotFoundError("No pending approval for this job");
  return err;
};

// AI question generation with a human approval step.
// `generation` is { start, resume } from the LangGraph pipeline (injected, so tests fake it).
export const createQuestionService = ({ interviewRepository, generation, rateLimiter, config }) => {
  const generate = async ({ interviewId, identityKey }) => {
    const interview = await interviewRepository.findById(interviewId);
    if (!interview) throw new NotFoundError("Interview not found");

    if (!config.openaiApiKey) throw new AppError(500, "AI not configured: OPENAI_API_KEY missing");

    const gate = rateLimiter.check(identityKey);
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
      throw toApiError(err);
    }
  };

  // Resolves a paused draft. The thread is always addressed by the interview in the URL,
  // so a jobId minted for another interview resolves to nothing (404) — never to that interview.
  const approve = async ({ interviewId, jobId, approved, questions }) => {
    if (typeof jobId !== "string" || typeof approved !== "boolean") {
      throw new ValidationError("jobId (string) and approved (boolean) are required");
    }
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
      throw toApiError(err);
    }
    if (!result.approved) return { status: "rejected" };

    const updated = await interviewRepository.findByIdWithInterviewer(interviewId);
    if (!updated) throw new NotFoundError("Interview not found");
    return { status: "approved", interview: updated };
  };

  return { generate, approve };
};

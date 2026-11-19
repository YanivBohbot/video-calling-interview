import { z } from "zod";
import { requiredString, optionalString } from "./fields.js";

const MISSING = "Missing required interview fields";
const STATUSES = ["scheduled", "live", "completed", "cancelled"];
const status = z.enum(STATUSES, { errorMap: () => ({ message: "Invalid status" }) });

export const createInterviewBody = z.object({
  candidateName: requiredString(MISSING),
  candidateEmail: requiredString(MISSING),
  role: requiredString(MISSING),
  // Parsed (and rejected as "Invalid scheduledAt") by the service.
  scheduledAt: z.union([z.string(), z.number()], { errorMap: () => ({ message: MISSING }) }),
  // null / 0 still fall back to the 60-minute default in the service.
  duration: z.number({ invalid_type_error: "Invalid duration" }).int("Invalid duration").nonnegative("Invalid duration").nullish(),
  interviewType: optionalString("Invalid interviewType"),
  notes: optionalString("Invalid notes"),
  interviewerId: optionalString("Invalid interviewerId"),
  interviewerClerkId: optionalString("Invalid interviewerClerkId"),
});

export const updateStatusBody = z.object({ status });

// `questions` is checked by validateQuestionsPayload in the service (field-specific messages).
export const updateInterviewBody = z.object({
  notes: z.string({ invalid_type_error: "Invalid notes" }).optional(),
  status: status.optional(),
});

import { z } from "zod";

const MESSAGE = "jobId (string) and approved (boolean) are required";

// `questions` is checked by validateQuestionsPayload in the service (field-specific messages).
export const approveQuestionsBody = z.object({
  jobId: z.string({ required_error: MESSAGE, invalid_type_error: MESSAGE }),
  approved: z.boolean({ required_error: MESSAGE, invalid_type_error: MESSAGE }),
});

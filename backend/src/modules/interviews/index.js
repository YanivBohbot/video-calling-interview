import { createInterviewRepository } from "./interview.repository.js";
import { createInterviewService } from "./interview.service.js";
import { createInterviewController } from "./interview.controller.js";
import { createInterviewRouter } from "./interview.routes.js";

// Wires the interviews feature. `resolveInterviewerId` comes from the users module.
export const createInterviewsModule = ({ prisma, resolveInterviewerId }) => {
  const interviewRepository = createInterviewRepository({ prisma });
  const interviewService = createInterviewService({ interviewRepository, resolveInterviewerId });
  const interviewController = createInterviewController({ interviewService });
  const router = createInterviewRouter({ interviewController });
  return { interviewRepository, interviewService, interviewController, router };
};

import { createSessionRepository } from "./session.repository.js";
import { createSessionService } from "./session.service.js";
import { createSessionController } from "./session.controller.js";
import { createSessionRouter } from "./session.routes.js";

// Wires the sessions feature: repository → service → controller → router.
export const createSessionsModule = ({ prisma }) => {
  const sessionRepository = createSessionRepository({ prisma });
  const sessionService = createSessionService({ sessionRepository });
  const sessionController = createSessionController({ sessionService });
  const router = createSessionRouter({ sessionController });
  return { sessionRepository, sessionService, sessionController, router };
};

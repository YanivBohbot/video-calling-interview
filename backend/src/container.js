import express from "express";
import legacyStreamRouter from "./routes/stream.routes.js";
import aiController from "./controllers/aiController.js";
import { protectRoute } from "./middlewares/protectRoute.js";
import { createSessionsModule } from "./modules/sessions/index.js";
import { createUsersModule } from "./modules/users/index.js";
import { createInterviewsModule } from "./modules/interviews/index.js";
import { createClerkHeaderStrategy } from "./auth/clerkHeaderStrategy.js";

// Temporary: the AI question routes keep their pre-refactor handlers until the
// questions module replaces them.
const createLegacyQuestionRouter = () => {
  const router = express.Router({ mergeParams: true });
  router.post("/generate", protectRoute, aiController.generateQuestions);
  router.post("/approve", protectRoute, aiController.approveQuestions);
  return router;
};

// Composition root: the only place that knows which implementation backs each
// dependency. Everything else receives its collaborators as parameters.
export const createContainer = ({ config, prisma }) => {
  const sessions = createSessionsModule({ prisma });
  const users = createUsersModule({ prisma });
  const interviews = createInterviewsModule({
    prisma,
    resolveInterviewerId: users.userService.resolveInterviewerId,
  });

  // Swap this line to change how callers are identified (e.g. OAuth later).
  const identityStrategy = createClerkHeaderStrategy({
    findUserByClerkId: users.userRepository.findIdentityByClerkId,
  });

  return {
    config,
    prisma,
    auth: { identityStrategy },
    modules: { sessions, users, interviews },
    routers: {
      sessions: sessions.router,
      users: users.router,
      interviews: interviews.router,
    },
    legacyRouters: {
      questions: createLegacyQuestionRouter(),
      stream: legacyStreamRouter,
    },
  };
};

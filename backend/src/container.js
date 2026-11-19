import legacyInterviewRouter from "./routes/interview.routes.js";
import legacyStreamRouter from "./routes/stream.routes.js";
import { createSessionsModule } from "./modules/sessions/index.js";
import { createUsersModule } from "./modules/users/index.js";
import { createClerkHeaderStrategy } from "./auth/clerkHeaderStrategy.js";

// Composition root: the only place that knows which implementation backs each
// dependency. Everything else receives its collaborators as parameters.
export const createContainer = ({ config, prisma }) => {
  const sessions = createSessionsModule({ prisma });
  const users = createUsersModule({ prisma });

  // Swap this line to change how callers are identified (e.g. OAuth later).
  const identityStrategy = createClerkHeaderStrategy({
    findUserByClerkId: users.userRepository.findIdentityByClerkId,
  });

  return {
    config,
    prisma,
    auth: { identityStrategy },
    modules: { sessions, users },
    routers: {
      sessions: sessions.router,
      users: users.router,
    },
    legacyRouters: {
      interviews: legacyInterviewRouter,
      stream: legacyStreamRouter,
    },
  };
};

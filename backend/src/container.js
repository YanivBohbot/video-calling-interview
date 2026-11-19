import legacyInterviewRouter from "./routes/interview.routes.js";
import legacyUserRouter from "./routes/user.routes.js";
import legacyStreamRouter from "./routes/stream.routes.js";
import { createSessionsModule } from "./modules/sessions/index.js";

// Composition root: the only place that knows which implementation backs each
// dependency. Everything else receives its collaborators as parameters.
export const createContainer = ({ config, prisma }) => {
  const sessions = createSessionsModule({ prisma });

  return {
    config,
    prisma,
    modules: { sessions },
    routers: {
      sessions: sessions.router,
    },
    legacyRouters: {
      interviews: legacyInterviewRouter,
      users: legacyUserRouter,
      stream: legacyStreamRouter,
    },
  };
};

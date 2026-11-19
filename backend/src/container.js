import legacyInterviewRouter from "./routes/interview.routes.js";
import legacyUserRouter from "./routes/user.routes.js";
import legacySessionRouter from "./routes/session.routes.js";
import legacyStreamRouter from "./routes/stream.routes.js";

// Composition root: the only place that knows which implementation backs each
// dependency. Everything else receives its collaborators as parameters.
export const createContainer = ({ config, prisma }) => {
  return {
    config,
    prisma,
    routers: {},
    legacyRouters: {
      interviews: legacyInterviewRouter,
      users: legacyUserRouter,
      sessions: legacySessionRouter,
      stream: legacyStreamRouter,
    },
  };
};

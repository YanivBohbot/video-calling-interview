import { StreamClient } from "@stream-io/node-sdk";
import { createRateLimiter } from "./lib/rateLimiter.js";
import {
  startQuestionGeneration,
  resumeQuestionGeneration,
} from "./agents/questionGenerator/graph.js";
import { createSessionsModule } from "./modules/sessions/index.js";
import { createUsersModule } from "./modules/users/index.js";
import { createInterviewsModule } from "./modules/interviews/index.js";
import { createQuestionsModule } from "./modules/questions/index.js";
import { createStreamModule } from "./modules/stream/index.js";
import { createClerkHeaderStrategy } from "./auth/clerkHeaderStrategy.js";

const AI_GENERATIONS_PER_HOUR = 10;
const ONE_HOUR_MS = 60 * 60 * 1000;

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

  const questions = createQuestionsModule({
    interviewRepository: interviews.interviewRepository,
    generation: { start: startQuestionGeneration, resume: resumeQuestionGeneration },
    rateLimiter: createRateLimiter({ max: AI_GENERATIONS_PER_HOUR, windowMs: ONE_HOUR_MS }),
    config,
    identityStrategy,
  });

  let streamClient;
  const stream = createStreamModule({
    getStreamClient: () =>
      (streamClient ??= new StreamClient(config.stream.apiKey, config.stream.apiSecret)),
  });

  return {
    config,
    prisma,
    auth: { identityStrategy },
    modules: { sessions, users, interviews, questions, stream },
    routers: {
      questions: questions.router,
      interviews: interviews.router,
      users: users.router,
      sessions: sessions.router,
      stream: stream.router,
    },
  };
};

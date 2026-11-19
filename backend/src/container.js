import { StreamClient } from "@stream-io/node-sdk";
import { createRateLimiter } from "./lib/rateLimiter.js";
import { startQuestionGeneration, resumeQuestionGeneration } from "./agents/questionGenerator/graph.js";
import { createClerkVerifier } from "./auth/clerkVerifier.js";
import { createDemoTokens } from "./auth/demoTokens.js";
import { createIdentityResolver } from "./auth/identityResolver.js";

import { createSessionRepository } from "./repositories/session.repository.js";
import { createUserRepository } from "./repositories/user.repository.js";
import { createInterviewRepository } from "./repositories/interview.repository.js";

import { createSessionService } from "./services/session.service.js";
import { createUserService } from "./services/user.service.js";
import { createInterviewService } from "./services/interview.service.js";
import { createQuestionService } from "./services/question.service.js";
import { createStreamService } from "./services/stream.service.js";

import { createSessionController } from "./controllers/session.controller.js";
import { createUserController } from "./controllers/user.controller.js";
import { createInterviewController } from "./controllers/interview.controller.js";
import { createQuestionController } from "./controllers/question.controller.js";
import { createStreamController } from "./controllers/stream.controller.js";
import { createAuthController } from "./controllers/auth.controller.js";

import { createSessionRouter } from "./routes/session.routes.js";
import { createUserRouter } from "./routes/user.routes.js";
import { createInterviewRouter } from "./routes/interview.routes.js";
import { createQuestionRouter } from "./routes/question.routes.js";
import { createStreamRouter } from "./routes/stream.routes.js";
import { createAuthRouter } from "./routes/auth.routes.js";

const AI_GENERATIONS_PER_HOUR = 10;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Composition root: the only place that knows which implementation backs each
// dependency, and the only place the layers are wired together:
//   repositories (Prisma) → services (business rules) → controllers (HTTP) → routes
//
// The optional parameters let tests swap an external dependency for a fake
// (AI pipeline, Clerk, Stream client, clock) while keeping everything else real.
// `identityResolver` replaces the whole credential check — HTTP tests use it to act as a
// given principal without minting real tokens (the real resolver has its own tests).
export const createContainer = ({
  config,
  prisma,
  generation = { start: startQuestionGeneration, resume: resumeQuestionGeneration },
  clerkVerifier,
  identityResolver,
  getStreamClient,
  now,
}) => {
  // ── Repositories ──────────────────────────────────────────────────────────
  const repositories = {
    session: createSessionRepository({ prisma }),
    user: createUserRepository({ prisma }),
    interview: createInterviewRepository({ prisma }),
  };

  // ── Identity: Clerk sessions, demo tokens, candidate invites → principal ───
  const demoTokens = createDemoTokens({ secret: config.demoTokenSecret });
  const auth = {
    demoTokens,
    resolver:
      identityResolver ??
      createIdentityResolver({
        clerkVerifier:
          clerkVerifier ??
          createClerkVerifier({ secretKey: config.clerk?.secretKey, authorizedParties: [config.clientUrl] }),
        demoTokens,
        userRepository: repositories.user,
        interviewRepository: repositories.interview,
      }),
  };

  // ── Services ──────────────────────────────────────────────────────────────
  let streamClient;
  const userService = createUserService({ userRepository: repositories.user });
  const services = {
    session: createSessionService({ sessionRepository: repositories.session }),
    user: userService,
    interview: createInterviewService({
      interviewRepository: repositories.interview,
      resolveInterviewerId: userService.resolveInterviewerId,
    }),
    question: createQuestionService({
      interviewRepository: repositories.interview,
      generation,
      rateLimiter: createRateLimiter({ max: AI_GENERATIONS_PER_HOUR, windowMs: ONE_HOUR_MS }),
      config,
    }),
    stream: createStreamService({
      // Built on first use, so the server boots without Stream keys.
      getStreamClient:
        getStreamClient ??
        (() => (streamClient ??= new StreamClient(config.stream?.apiKey, config.stream?.apiSecret))),
      now,
    }),
  };

  // ── Controllers ───────────────────────────────────────────────────────────
  const controllers = {
    session: createSessionController({ sessionService: services.session }),
    user: createUserController({ userService: services.user }),
    interview: createInterviewController({ interviewService: services.interview }),
    question: createQuestionController({ questionService: services.question }),
    stream: createStreamController({ streamService: services.stream }),
    auth: createAuthController({ demoTokens }),
  };

  // ── Routers (mounted by app.js) ───────────────────────────────────────────
  const routers = {
    auth: createAuthRouter({ authController: controllers.auth }),
    questions: createQuestionRouter({ questionController: controllers.question }),
    interviews: createInterviewRouter({ interviewController: controllers.interview }),
    users: createUserRouter({ userController: controllers.user }),
    sessions: createSessionRouter({ sessionController: controllers.session }),
    stream: createStreamRouter({ streamController: controllers.stream }),
  };

  return { config, prisma, auth, repositories, services, controllers, routers };
};

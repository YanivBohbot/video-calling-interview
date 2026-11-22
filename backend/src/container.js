import { StreamClient } from "@stream-io/node-sdk";
import { createRateLimiter } from "./lib/rateLimiter.js";
import {
  workflow,
  createQuestionModels,
  createCheckpointer,
  createQuestionGenerator,
} from "./agents/questionGenerator/index.js";
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
import { createCodeService } from "./services/code.service.js";

import { createSessionController } from "./controllers/session.controller.js";
import { createUserController } from "./controllers/user.controller.js";
import { createInterviewController } from "./controllers/interview.controller.js";
import { createQuestionController } from "./controllers/question.controller.js";
import { createStreamController } from "./controllers/stream.controller.js";
import { createCodeController } from "./controllers/code.controller.js";
import { createAuthController } from "./controllers/auth.controller.js";

import { createSessionRouter } from "./routes/session.routes.js";
import { createUserRouter } from "./routes/user.routes.js";
import { createInterviewRouter } from "./routes/interview.routes.js";
import { createQuestionRouter } from "./routes/question.routes.js";
import { createStreamRouter } from "./routes/stream.routes.js";
import { createCodeRouter } from "./routes/code.routes.js";
import { createPistonClient } from "./integrations/piston/client.js";
import { createLeetCodeClient } from "./integrations/leetcode/client.js";
import { createAuthRouter } from "./routes/auth.routes.js";

const AI_GENERATIONS_PER_HOUR = 10;
// Shared by every demo visitor (the demo is public).
const DEMO_AI_GENERATIONS_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;
// Run button: per caller (see services/code.service.js).
const CODE_RUNS_PER_MINUTE = 30;
const ONE_MINUTE_MS = 60 * 1000;

// Composition root: the only place that knows which implementation backs each
// dependency, and the only place the layers are wired together:
//   repositories (Prisma) → services (business rules) → controllers (HTTP) → routes
//
// The optional parameters let tests swap an external dependency for a fake
// (AI pipeline, Clerk, Stream client, code runner, clock) while keeping everything else real.
// `leetcode` replaces the LeetCode GraphQL client (tests).
// `identityResolver` replaces the whole credential check — HTTP tests use it to act as a
// given principal without minting real tokens (the real resolver has its own tests).
export const createContainer = ({
  config,
  prisma,
  generation,
  clerkVerifier,
  identityResolver,
  getStreamClient,
  codeRunner,
  leetcode,
  now,
}) => {
  // ── Repositories ──────────────────────────────────────────────────────────
  const repositories = {
    session: createSessionRepository({ prisma }),
    user: createUserRepository({ prisma }),
    interview: createInterviewRepository({ prisma }),
  };

  // ── AI question generator (built on first use: the Postgres checkpointer and
  //    the models are only created when someone generates) ──────────────────
  let aiStack;
  const getAi = () => {
    if (!aiStack) {
      const models = createQuestionModels({ model: config.aiModel, fallbackModel: config.aiModelFallback });
      const checkpointer = createCheckpointer({ connectionString: config.databaseUrl });
      const graph = workflow.compile({ checkpointer });
      // The graph's runtime context (QuestionGenContext): what the nodes call.
      const context = {
        chooseSearch: models.chooseSearch,
        searchProblems: (leetcode ?? createLeetCodeClient()).searchProblems,
        draft: models.draft,
        saveQuestions: repositories.interview.saveQuestions,
      };
      aiStack = { checkpointer, generator: createQuestionGenerator({ graph, context }) };
    }
    return aiStack;
  };
  const ai = {
    // Boot: create the checkpointer tables.
    setup: () => getAi().checkpointer.setup(),
  };
  const questionGeneration = generation ?? {
    start: (args) => getAi().generator.start(args),
    resume: (args) => getAi().generator.resume(args),
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
    interview: createInterviewService({ interviewRepository: repositories.interview, clientUrl: config.clientUrl }),
    question: createQuestionService({
      interviewRepository: repositories.interview,
      generation: questionGeneration,
      rateLimiter: createRateLimiter({ max: AI_GENERATIONS_PER_HOUR, windowMs: ONE_HOUR_MS }),
      demoRateLimiter: createRateLimiter({ max: DEMO_AI_GENERATIONS_PER_HOUR, windowMs: ONE_HOUR_MS }),
      config,
    }),
    stream: createStreamService({
      // Built on first use, so the server boots without Stream keys.
      getStreamClient:
        getStreamClient ??
        (() => (streamClient ??= new StreamClient(config.stream?.apiKey, config.stream?.apiSecret))),
      now,
    }),
    code: createCodeService({
      codeRunner: codeRunner ?? createPistonClient({ baseUrl: config.pistonUrl }),
      rateLimiter: createRateLimiter({ max: CODE_RUNS_PER_MINUTE, windowMs: ONE_MINUTE_MS }),
    }),
  };

  // ── Controllers ───────────────────────────────────────────────────────────
  const controllers = {
    session: createSessionController({ sessionService: services.session }),
    user: createUserController({ userService: services.user }),
    interview: createInterviewController({ interviewService: services.interview }),
    question: createQuestionController({ questionService: services.question }),
    stream: createStreamController({ streamService: services.stream }),
    code: createCodeController({ codeService: services.code }),
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
    code: createCodeRouter({ codeController: controllers.code }),
  };

  return { config, prisma, auth, ai, repositories, services, controllers, routers };
};

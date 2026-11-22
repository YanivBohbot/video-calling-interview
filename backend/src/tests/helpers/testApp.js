import { createContainer } from "../../container.js";
import { createApp } from "../../app.js";

export const TEST_CONFIG = Object.freeze({
  clientUrl: "http://localhost:5174",
  openaiApiKey: "sk-test",
  aiQuestionCount: 6,
  stream: {},
  clerk: { secretKey: "sk_test_fake", publishableKey: "pk_test_fake" },
  demoTokenSecret: "test-demo-secret-0123456789abcdef0123",
});

// Ready-made principals for HTTP tests.
export const PRINCIPALS = Object.freeze({
  ada: { kind: "interviewer", userId: "u-ada", clerkId: "clerk_ada" },
  bob: { kind: "interviewer", userId: "u-bob", clerkId: "clerk_bob" },
  demo: { kind: "demo", userId: "u-demo", clerkId: "demo" },
  candidateOf: (interviewId) => ({ kind: "candidate", interviewId }),
  practiceOf: (interviewId) => ({ kind: "practice", interviewId }),
});

// Fake Clerk: the bearer "clerk:<clerkId>" verifies to that id; no network.
export const fakeClerkVerifier = ({ profile = { name: "New User", email: "new@x.dev", profileImage: null } } = {}) => ({
  verify: async (token) => (typeof token === "string" && token.startsWith("clerk:") ? { clerkId: token.slice(6) } : null),
  fetchUser: async () => profile,
});

// Test-only identity: `Authorization: Bearer test-principal:<json>` is that principal
// ("null" → no principal). Without the header, `defaultPrincipal` is used.
const TEST_PREFIX = "test-principal:";
export const authAs = (principal) => ({ Authorization: `Bearer ${TEST_PREFIX}${JSON.stringify(principal)}` });

// Like the real resolver, /api/practice only accepts practice principals (and every other
// route never sees them).
export const testIdentityResolver = (defaultPrincipal) => {
  const fromRequest = async (req) => {
    const auth = req.header("authorization") || "";
    if (auth.startsWith(`Bearer ${TEST_PREFIX}`)) return JSON.parse(auth.slice(7 + TEST_PREFIX.length));
    return defaultPrincipal;
  };
  return {
    fromRequest,
    fromCredentials: async () => defaultPrincipal,
    fromPracticeRequest: async (req) => {
      const principal = await fromRequest(req);
      return principal?.kind === "practice" ? principal : null;
    },
  };
};

// The real container (every repository, service, controller and router) over a stub
// `prisma`, with optional fakes for the external dependencies the container accepts.
// Requests act as `principal` (default: the demo owner) unless they send `authAs(...)`.
export const buildTestApp = ({ prisma = {}, config = TEST_CONFIG, principal = PRINCIPALS.demo, appOptions, ...fakes } = {}) => {
  const container = createContainer({
    config,
    prisma,
    identityResolver: testIdentityResolver(principal),
    clerkVerifier: fakeClerkVerifier(),
    ...fakes,
  });
  return { app: createApp(container, appOptions), container };
};

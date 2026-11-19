import { createContainer } from "../container.js";
import { createApp } from "../app.js";

export const TEST_CONFIG = Object.freeze({
  clientUrl: "http://localhost:5174",
  openaiApiKey: "sk-test",
  aiQuestionCount: 6,
  stream: {},
  clerk: { secretKey: "sk_test_fake", publishableKey: "pk_test_fake" },
  demoTokenSecret: "test-demo-secret-0123456789abcdef0123",
});

// The real container (every repository, service, controller and router) over a stub
// `prisma`, with optional fakes for the external dependencies the container accepts.
export const buildTestApp = ({ prisma = {}, config = TEST_CONFIG, ...fakes } = {}) => {
  const container = createContainer({ config, prisma, ...fakes });
  return { app: createApp(container), container };
};

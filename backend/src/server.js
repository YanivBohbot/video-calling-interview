import "dotenv/config";
import { createServer } from "http";
import { loadConfig } from "./config/env.js";
import { connectDB, prisma } from "./lib/db.js";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";
import { attachRealtime } from "./realtime/index.js";
import { createSocketAuthenticator } from "./realtime/authenticateSocket.js";
import { createRoomAccess } from "./realtime/roomAccess.js";

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // Only variable names are in this message — never their values.
  console.error(err.message);
  process.exit(1);
}

const container = createContainer({ config, prisma });
const httpServer = createServer(createApp(container));
const realtime = attachRealtime({
  httpServer,
  clientUrl: config.clientUrl,
  interviewStore: prisma.interview,
  findCodeSnapshot: container.repositories.interview.findCodeSnapshot,
  authenticator: createSocketAuthenticator(container.auth.resolver),
  canAccessRoom: createRoomAccess({ interviewRepository: container.repositories.interview }),
});

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — saving open rooms and shutting down`);
  try {
    await realtime.shutdown(); // closes the sockets and, with them, the HTTP server
    await container.ai.close(); // stops the LeetCode MCP child process
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Shutdown error:", err.message);
    process.exit(1);
  }
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const startServer = async () => {
  await connectDB();
  httpServer.listen(config.port, () => {
    console.log(`Server running on port ${config.port} (client: ${config.clientUrl})`);
  });
  // Warm the LeetCode MCP connection at boot (fire-and-forget) so the npx download and
  // stdio handshake happen now, not on the first user-facing generate request.
  // It never rejects; it resolves to [] on failure and retries on the next call.
  container.ai.warmUp().catch(() => {});
  // Idempotent: creates the LangGraph checkpointer's Postgres tables if missing. Best-effort —
  // a slow DB at boot must not crash the server; generation will then fail per-request instead.
  container.ai.setup().catch((err) => console.error("Checkpointer setup failed:", err.message));
};

startServer().catch((err) => {
  console.error("Start server error:", err.message);
  process.exit(1);
});

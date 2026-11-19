import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Persists paused drafts (human approval) in Postgres. Own schema, so `prisma migrate dev`
// never sees these tables as drift in `public`. Call `.setup()` once at boot.
export const createCheckpointer = ({ connectionString }) =>
  PostgresSaver.fromConnString(connectionString, { schema: "langgraph" });

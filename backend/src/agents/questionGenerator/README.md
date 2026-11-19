# AI question generator

Drafts interview questions for one interview, grounded on real LeetCode problems, and
saves them only after the interviewer approves them. Built with LangGraph (JS) and laid
out like the official [application structure](https://docs.langchain.com/oss/javascript/langgraph/application-structure).

```
questionGenerator/
├── agent.js          graph construction — the `workflow` (doc: agent.ts)
├── utils/
│   ├── state.js      state schema + runtime-context schema (doc: utils/state.ts)
│   ├── nodes.js      the node functions (doc: utils/nodes.ts)
│   ├── tools.js      LeetCode MCP tools + the search the researcher runs (doc: utils/tools.ts)
│   ├── models.js     the two structured-output model calls
│   ├── prompts.js    system prompts
│   └── sources.js    LeetCode result parsing, source attribution
├── checkpointer.js   PostgresSaver (persistence)
├── runner.js         start / resume a generation (the API the service calls)
└── errors.js         errors the API maps to HTTP statuses
```

Assembled in `src/container.js`, which compiles `workflow` with the Postgres checkpointer
and builds the runtime context from validated config. Nothing here imports Prisma or reads
`process.env` (enforced by `src/tests/aiWiring.test.js`).

## The workflow

```
START → planner → researcher → drafter → validator ─┬→ humanApproval ─┬→ finalize → END
                                 ↑         │         │   (interrupt)    └→ END (rejected)
                                 │         ├→ drafter (retry with the errors)
                                 └ fallback ←┘ (retries spent: switch to the fallback model)
```

| Node | Kind | Does |
|---|---|---|
| planner | data | splits the question count across categories |
| researcher | LLM + tool | the model picks LeetCode search filters; code runs the search (degrades to no grounding on failure) |
| drafter | LLM | drafts the questions (structured output), `retryPolicy` for transient errors |
| validator | routing | `Command` → approval, retry, or fallback model |
| fallback | data | switches to `AI_MODEL_FALLBACK` |
| humanApproval | user input | `interrupt()` with the draft; resumed with the decision |
| finalize | action | saves the approved questions through the interview repository |

## How it follows the docs

| Choice | Doc |
|---|---|
| `StateGraph` + `StateSchema` (zod), nodes return partial updates, `Command` + `ends` for routing | [Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) |
| Dependencies (models, search, DB save) passed as **runtime context**: `new StateGraph(State, QuestionGenContext)`, `invoke(..., { context })`, read as `runtime.context` — not stored in checkpoints | [Graph API — runtime context](https://docs.langchain.com/oss/javascript/langgraph/graph-api#runtime-context) |
| Human approval with `interrupt()` + `Command({ resume })`, one `thread_id` per job (`interviewId:jobId`) | [Human-in-the-loop](https://docs.langchain.com/oss/javascript/langgraph/interrupts) |
| `PostgresSaver` in its own `langgraph` schema, `setup()` at boot | [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) |
| `initChatModel("provider:model").withStructuredOutput(zodSchema)` | [Models — structured output](https://docs.langchain.com/oss/javascript/langchain/models) |
| MCP tools through `@langchain/mcp-adapters`, server version pinned | [MCP](https://docs.langchain.com/oss/javascript/langchain/mcp) |

**Why a workflow and not `createAgent`.** `createAgent` is LangChain's tool-calling *agent
loop*. This pipeline has fixed steps, so it is a LangGraph *workflow*
([workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)):
each LLM step is one typed call, and code, not the model, runs the LeetCode search. An
earlier agent version let the model drive the search tool; it ignored the offset, repeated
the same problems and hit its step limit.

**No `langgraph.json`.** LangGraph Studio (`langgraph dev`) would have to run the graph
without our runtime context (models, MCP client, repository), which only the container
builds. Supporting it would mean reading `process.env` and importing Prisma in here.

## Configuration

`AI_MODEL` / `AI_MODEL_FALLBACK`: LangChain `provider:model` strings (defaults
`openai:gpt-4o-mini` / `openai:gpt-4o`; a bare name means OpenAI). The provider's own
key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) must be set, and its package installed
(`@langchain/openai` is).

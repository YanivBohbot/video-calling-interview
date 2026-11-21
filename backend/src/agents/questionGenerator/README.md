# AI question generator

Drafts interview questions for one interview, grounded on real LeetCode problems, and
saves them only after the interviewer picks and approves them. Built with LangGraph (JS).

## Layout — one folder per responsibility

```
questionGenerator/
├── index.js                 the only entry point (container.js imports from here)
├── errors.js                errors the API maps to HTTP statuses
│
├── graph/                   WHAT the pipeline is
│   ├── workflow.js          nodes + edges, exported uncompiled
│   ├── state.js             state schema + runtime-context schema
│   └── nodes/               one node per file, plain (state, runtime) functions
│       ├── planner.js       ├── validator.js      ├── humanApproval.js
│       ├── researcher.js    ├── fallback.js       └── finalize.js
│       └── drafter.js       (index.js re-exports them)
│
├── llm/                     talking to the models
│   ├── models.js            initChatModel("provider:model").withStructuredOutput(zod)
│   └── prompts.js           system prompts
│
├── mcp/                     MCP server connections — one folder per server
│   └── leetcode/
│       └── client.js        LeetCode MCP server via @langchain/mcp-adapters (pinned, closable)
│
├── tools/                   the tools the graph uses — one folder per source
│   └── leetcode/
│       ├── search.js        the search_problems call the researcher runs
│       └── sources.js       parse results, attach verified sources to questions
│
└── execution/               running it
    ├── generator.js         start / resume a generation (one thread per job)
    └── checkpointer.js      PostgresSaver, own "langgraph" schema
```

Dependencies point one way: `execution → graph → (llm, tools → mcp)` only through the
runtime context — nodes never import `llm/` or `mcp/`; `container.js`
builds those and passes them in. Nothing here imports Prisma or reads `process.env`, and
nothing outside imports a file other than `index.js` (both enforced by
`src/tests/architecture/aiWiring.test.js`).

## Tests

The tests live outside this folder, in `src/tests/agents/questionGenerator/`, with the
same tree as the code: `graph/nodes/` → `tests/agents/questionGenerator/graph/nodes/nodes.test.js`,
`mcp/leetcode/client.js` → `tests/agents/questionGenerator/mcp/leetcode/client.test.js`, and so on.

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

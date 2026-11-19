# Audit — AI question-generator agent vs LangChain / LangGraph official guidance

Date: 2026-11-20 · Scope: `backend/src/agents/**` (LeetCode MCP client + LangGraph question-generator pipeline) and how `services/question.service.js` uses it.
References: skills `langchain-fundamentals`, `langchain-dependencies`, `langchain-typescript-quickstart`; LangChain JS docs (docs.langchain.com/oss/javascript — models / structured output, quickstart).

**Status (2026-11-20): recommendations 1–4 applied on `refactor/ai-agent`** — `graph.js` split into models / leetcodeSearch / graph / checkpointer / runner; config + repository injected through `container.js`; `initChatModel(...).withStructuredOutput()` with `provider:model` strings; `AIConfigError` thrown on model init failure; MCP server pinned to 1.5.1 (1.4.0 no longer starts) and closed on shutdown. Verified live: one real generation (6 questions, 4 LeetCode-grounded), rejected without writing. Recommendation 5 (LangSmith) not applied — optional.

**Follow-up (2026-11-20, `refactor/agent-structure`):** layout aligned with the LangGraph application-structure page (`agent.js` + `utils/{state,nodes,tools,models,prompts,sources}.js`); dependencies passed as LangGraph runtime context (`contextSchema` / `runtime.context`) instead of node factories — verified on 1.4.21 to survive interrupt, resume and the finalize retry, and to stay out of checkpoints; `README.md` in the agent folder maps each choice to its doc page. `langgraph.json` deliberately not added (Studio can't supply the runtime context).

## Verdict

**The agent uses the current (v1) APIs correctly and the pipeline design is sound** — explicit LangGraph graph, human-in-the-loop with `interrupt()` + checkpointer, typed state, retry policy, structured output, MCP tools through the official adapter. Nothing is on a deprecated/legacy API.

**The weak point is architecture, not LangChain usage**: `graph.js` mixes five responsibilities, the agent reads `process.env` and Prisma directly (bypassing the config and repository layers built in the backend refactor), and it relies on module-level singletons instead of the container. These make it harder to read and to test than the rest of the backend.

## 1. Dependencies (langchain-dependencies)

| Check | Status |
|---|---|
| Node ≥ 20 (quickstart: 22+) | ✅ Node 24 |
| `langchain` ≥ 1.0 (LTS) | ✅ 1.5.4 |
| `@langchain/core` listed explicitly (peer dep) | ✅ 1.2.3 |
| Orchestration: one of LangGraph / Deep Agents | ✅ `@langchain/langgraph` 1.4.21 only |
| Provider package for the model used | ✅ `@langchain/openai` 1.5.5 |
| Checkpointer package | ✅ `@langchain/langgraph-checkpoint-postgres` 1.0.6 |
| MCP | ✅ `@langchain/mcp-adapters` 1.1.3 (dedicated package, not community) |
| No `@langchain/community` | ✅ |
| `langsmith` (recommended for tracing) | ⚠️ only transitive (0.8.7); not declared, no tracing configured |
| Runtime MCP server version | ❌ `npx -y @jinzcdev/leetcode-mcp-server` — **unpinned**, downloaded at runtime (supply-chain risk, non-reproducible) |

## 2. LangChain / LangGraph usage (langchain-fundamentals)

| Pattern | Where | Status |
|---|---|---|
| Graph built with `StateGraph` + `StateSchema` (zod) | `graph.js`, `state.js` | ✅ current v1 API |
| Conditional routing with `Command({ update, goto })` + `ends` declared | `validatorNode`, `humanApprovalNode` | ✅ |
| HITL: `interrupt()` first in the node, resume with `Command({ resume })`, `thread_id` per job | `humanApprovalNode`, `resumeQuestionGeneration` | ✅ textbook (and the "no side effects before interrupt" rule is documented in code) |
| Persistence: `PostgresSaver` + `setup()` in its own schema | `getCheckpointer` | ✅ |
| Retry on transient LLM errors | `retryPolicy: { maxAttempts: 3 }` on drafter | ✅ |
| Loop guard | `recursionLimit: 10` on the drafter call; bounded content retries + one fallback model | ✅ |
| Structured output with zod | `createAgent({ tools: [], responseFormat })` in `defaultChooseSearch` / `defaultBuildDrafterAgent` | ⚠️ works, but **not the idiomatic tool for the job**: with no tools there is no agent loop, and the docs' pattern for a single typed model call is `model.withStructuredOutput(schema)` (validated with zod). `createAgent` is for tool-calling loops. |
| Model selection | hard-coded `` `openai:${AI_MODEL}` `` | ⚠️ provider locked in the code; LangChain is model-agnostic — the full `provider:model` string should come from config (e.g. `AI_MODEL=openai:gpt-4o-mini`) via `initChatModel` |
| Model/agent construction | rebuilt on every call (`createAgent` per researcher/drafter invocation) | ⚠️ minor cost; build once per model |
| MCP tools | `MultiServerMCPClient.getTools()`, allow-list of 3 tools, failures degrade gracefully, transient failures not memoised | ✅ |
| Tool use | `search_problems` is invoked **by code**, the model only picks filters (documented reason: the tool loop ignored offsets and hit the step limit) | ✅ deliberate and justified |
| MCP client lifecycle | stdio child process never closed (no `client.close()` on shutdown) | ⚠️ leaks the `npx` child on restart |

## 3. Architecture & readability

| Finding | Impact |
|---|---|
| **`graph.js` does five jobs**: LLM calls (researcher + drafter models), LeetCode search adapter, graph wiring, Postgres checkpointer singleton, and the public start/resume API. | Hard to read; the "what does the pipeline look like" part is buried. |
| **Reads `process.env` directly** (`AI_MODEL`, `AI_MODEL_FALLBACK`, `DATABASE_URL`) while the rest of the backend gets validated config from `config/env.js`. | Two sources of truth; a missing/typo'd model name is only discovered at the first generation. |
| **`finalize` node writes with Prisma directly** (`agents/` imports `lib/db.js`). | Bypasses the repository layer (only `repositories/` should touch Prisma). |
| **Module-level singletons** (`pgCheckpointer`, `defaultGraph`, cached MCP tools) instead of being created in `container.js`. | Hidden global state; tests rely on `_reset…` helpers and optional `{ graph }` params. |
| **`AIConfigError` is never thrown** — the service maps it but nothing raises it. | Dead branch; config errors surface as generic provider errors. |
| `nodes.js` (175 lines) is cohesive; `state.js`, `prompts.js`, `sources.js` are small, single-purpose and well commented. Test coverage of nodes/graph/sources/state is good. | ✅ |

## 4. Recommended changes (in order)

1. **Split `graph.js`** into
   - `models.js` — `createChooseSearch({ model })`, `createDrafter({ model, fallbackModel })` using `initChatModel(config.aiModel).withStructuredOutput(Schema)`; models built once.
   - `leetcodeSearch.js` — `createSearchProblems({ getTools })` (wraps the MCP tool + `parseSearchProblems`).
   - `graph.js` — only `buildGraph({ checkpointer, chooseSearch, searchProblems, drafter, saveQuestions })`.
   - `runner.js` — `createQuestionGenerator({ graph })` → `{ start, resume }` (today's `startQuestionGeneration` / `resumeQuestionGeneration`).
2. **Inject instead of import**: `finalize` receives `saveQuestions(interviewId, questions)` (backed by a new `interviewRepository.saveQuestions`); the checkpointer, MCP client and models are created in `container.js` from `config` (`AI_MODEL`, `AI_MODEL_FALLBACK` validated in `config/env.js`, full `provider:model` strings).
3. **Throw `AIConfigError`** when the model string can't be initialised, so the API returns the existing "AI not configured" style 500 with a clear message.
4. **Pin the MCP server** (`@jinzcdev/leetcode-mcp-server@<version>`) and **close the MCP client** in the graceful shutdown.
5. Optional: declare `langsmith` and document `LANGSMITH_API_KEY` / `LANGSMITH_TRACING` to get traces of each generation.

Behaviour, prompts, graph topology and tests' assertions stay the same; only wiring and file boundaries move — the same kind of change as the backend layering refactor.

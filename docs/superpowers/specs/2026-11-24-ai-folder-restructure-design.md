# AI folder restructure — design

## Intent

Make the agentic part of the backend readable at a glance: which agents exist, which
tools they use, where their prompts live. Today `src/agents/` mixes two kinds of things
(two `createAgent` ReAct agents and one LangGraph pipeline), and each keeps its own prompts
and helpers in its own folder, so the shape of the system is not visible from the tree.

## Goals / non-goals

- Goal: one folder per kind of building block, named after what it holds, in LangChain's own
  vocabulary (agents vs workflows, tools, prompts, middleware).
- Goal: the code stays conformant to the current LangChain / LangGraph JS docs.
- Non-goal: no behaviour change. Same API, same SSE events, same reports, same limits.
- Anti-goal: a reorganisation that breaks a test or forces a change outside the AI code
  beyond import paths.

## Approaches considered

1. **`src/ai/` root with `agents/`, `workflows/`, `tools/`, `prompts/`, `middleware/`** — chosen.
   Every folder name says what is in it; agents (ReAct, the model decides) are visibly
   separate from workflows (fixed graph).
2. Keep `src/agents/` as root with the same sub-folders — rejected: `agents/agents/` or
   agents mixed at the same level as `tools/` and `prompts/`.
3. Treat the question generator as one more agent (no `workflows/`) — rejected by the user:
   a 7-node graph with a human-approval interrupt is not a ReAct agent.

## Target layout

```
src/ai/
  agents/                          createAgent (ReAct) agents
    interviewer/                   agent.js, events.js, messages.js, repair.js, index.js
    coach/                         agent.js, report.js (schema + honest-report check), index.js
  workflows/                       LangGraph StateGraph pipelines
    questionGenerator/             workflow.js, state.js, nodes/, models.js, sources.js,
                                   generator.js, errors.js, index.js, README.md
  tools/                           every LangChain tool, one factory per file
    runCode.js, findProblem.js, readCandidateCode.js, endSession.js, index.js
  prompts/                         one file per agent / workflow
    interviewer.js, coach.js, questionGenerator.js, index.js
  middleware/                      unchanged content
  checkpointer.js                  PostgresSaver shared by the interviewer and the workflow
  README.md                        the map: what is an agent, a workflow, a tool, a prompt
```

Notes:
- `questionGenerator/tools/leetcode/sources.js` is not a LangChain tool (plain helper that
  attaches verified sources), so it moves to `workflows/questionGenerator/sources.js`.
- `questionGenerator/llm/models.js` is workflow-specific (`withStructuredOutput` calls), so
  it stays with the workflow as `models.js`.
- Agent folders are renamed `practiceInterviewer` → `interviewer`, `practiceCoach` → `coach`
  (the `ai/agents/` path already says what they are). Exported factory names
  (`createPracticeInterviewer`, `createPracticeCoach`) do not change.
- Tests move to `src/tests/ai/` with the same tree.

## Rules kept (and updated in `tests/architecture/aiWiring.test.js`)

- The rest of the backend imports an agent / workflow only through its `index.js`.
- Nothing under `src/ai/` imports Prisma, `src/integrations/` or reads `process.env`.
- Dependencies point one way: `agents/`, `workflows/` → `tools/`, `prompts/`, `middleware/`;
  those shared folders never import an agent or a workflow.

## LangChain conformance

Check the code against the current docs (createAgent, middleware hooks,
`dynamicSystemPromptMiddleware`, `responseFormat` / `toolStrategy`, `StateGraph`,
`interrupt` / `Command`, checkpointer). Small deviations are fixed in the same work;
anything that would change behaviour is listed for the user before being touched.

## Done when

- All 424 backend tests pass, plus `aiWiring` rules for the new layout.
- `container.js`, `services/question.service.js`, `validators/question.validation.js`,
  `tests/http/questions.test.js` import from `src/ai/...`.
- `CLAUDE.md` and the READMEs describe the new layout. Old docs under `docs/superpowers/`
  are history and are not rewritten.

## Conformance findings (2026-11-24, langchain 1.5.4, @langchain/langgraph 1.4.21)

Checked against docs.langchain.com/oss/javascript (agents, runtime, tools, middleware,
structured output, Graph API, interrupts, persistence). No change needed.

| Point | Code | Verdict |
|---|---|---|
| Agents | `createAgent({ model, tools, contextSchema, checkpointer, middleware })` | conformant |
| Dynamic prompt | `dynamicSystemPromptMiddleware((state, runtime) => …runtime.context)` | conformant |
| Runtime context | per call via `{ context }`, read in tools as `runtime.context`; never checkpointed | conformant |
| Tools | `tool(fn, { name, description, schema: zod })` from `langchain`, every field `.describe()`d | conformant |
| Structured output | `responseFormat: toolStrategy(schema)`, read from `structuredResponse` | conformant |
| Middleware | built-in `modelCallLimitMiddleware` / `toolCallLimitMiddleware` / `modelFallbackMiddleware`; own `createMiddleware` with `wrapModelCall` / `wrapToolCall` | conformant (the coach's wrap-only budget is a documented workaround for the langchain 1.5 structured-retry issue) |
| Workflow | `new StateGraph(StateSchema, contextSchema)`, `Command` + `ends`, `retryPolicy`, compiled by the caller | conformant |
| Human approval | `interrupt()` first in the node, resumed with `Command({ resume })`, one thread per job | conformant |
| Persistence | `PostgresSaver` (own schema) + `MemorySaver` in tests | conformant |

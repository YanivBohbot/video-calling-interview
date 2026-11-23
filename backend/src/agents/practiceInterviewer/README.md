# Practice interviewer agent

A LangChain `createAgent` (ReAct loop: model ↔ tools) that runs a candidate's practice
session: it picks a problem, writes its own statement, reads and runs the candidate's code,
gives graduated hints and decides when the session is over.

- `index.js` — the only entry point: `createPracticeInterviewer({ model, fallbackModel, runCode, languages, searchProblems, checkpointer, log })` → `{ streamTurn, history }`.
- `agent.js` — the agent (`createAgent`), its runtime context (`sessionId, role, interviewType, code, language`, never checkpointed), `streamTurn` and `history`.
- `events.js` — the agent's stream → `token` / `tool` (`endsSession` when it was `end_session`) / `done` events.
- `repair.js` — answers tool calls left unanswered by an aborted turn, before the next one.
- `messages.js` — helpers over LangChain messages (thread id, text).
- `prompts.js` — the system prompt, built per call by `dynamicSystemPromptMiddleware`.

Tools (shared, `agents/tools/`): `find_problem` (LeetCode titles and links only), `read_candidate_code`,
`run_code` (Piston), `end_session` (acknowledges only: the practice service closes the session after the turn).

Middleware (`agents/middleware/`): ≤ 6 model calls and ≤ 8 tool calls per turn (`limited: true` when
hit), the fallback model, content-free logging. The conversation lives in the checkpointer,
thread `practice:<sessionId>`.

Tests (`src/tests/agents/practiceInterviewer/`) use LangChain's `fakeModel()` to replay scripted
tool calls, and `MemorySaver`: no API key needed.

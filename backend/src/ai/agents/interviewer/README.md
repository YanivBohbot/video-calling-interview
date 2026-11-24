# Interviewer agent

A LangChain `createAgent` (ReAct loop: model ↔ tools) that runs a candidate's AI
session: it picks a problem, writes its own statement, reads and runs the candidate's code,
gives graduated hints and decides when the session is over. In avatar mode it runs the
whole spoken interview: it walks the interview's questions in order with `present_question`, and
its replies (spoken word for word by the avatar) are short plain sentences.

- `index.js` — the only entry point: `createPracticeInterviewer({ model, fallbackModel, runCode, languages, searchProblems, checkpointer, log })` → `{ streamTurn, history }`.
- `agent.js` — the agent (`createAgent`), its runtime context (`sessionId, role, interviewType, code, language, question, mode, company, interviewLanguage, questions`, never checkpointed; the system prompt is chosen by `mode`), `streamTurn` and `history`.
- `events.js` — the agent's stream → `token` / `tool` (`endsSession` when it was `end_session`) / `question` (`{ index }`, from a valid `present_question` result) / `done` events.
- `repair.js` — answers tool calls left unanswered by an aborted turn, before the next one.
- `messages.js` — helpers over LangChain messages (thread id, text).

Prompts (`ai/prompts/interviewer.js`): the system prompts (text: `buildInterviewerPrompt`,
avatar: `buildAvatarInterviewerPrompt`), built per call by `dynamicSystemPromptMiddleware`,
and the question-switch note (text mode only).

Tools (shared, `ai/tools/`): `find_problem` (LeetCode titles and links only), `read_candidate_code`,
`run_code` (Piston), `end_session` (acknowledges only: the practice service closes the session after the turn),
`present_question` (avatar mode only: shows question `index` on the candidate's screen).

Middleware (`ai/middleware/`): ≤ 6 model calls and ≤ 8 tool calls per turn (`limited: true` when
hit), the fallback model, content-free logging. The conversation lives in the checkpointer,
thread `practice:<sessionId>`.

Tests (`src/tests/ai/agents/interviewer/`, prompt tests in `src/tests/ai/prompts/`) use LangChain's `fakeModel()` to replay scripted
tool calls, and `MemorySaver`: no API key needed.

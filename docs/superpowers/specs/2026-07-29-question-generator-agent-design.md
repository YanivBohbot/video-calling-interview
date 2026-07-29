# Personalized Question-Generator Agent — Design

**Date:** 2026-07-29
**Status:** Approved (pending user review of written spec)
**Feature:** Sub-project 2 of 3 in the "AI agent" initiative. Depends on sub-project 1 (code & questions foundation — already implemented, merged to master), which added the empty `Interview.questions Json?` column this feature fills. Sub-project 3 (post-interview judge agent) is specced separately, later.

**Supersedes:** `docs/superpowers/specs/2026-05-17-ai-question-generator-design.md` (a single-shot, non-agent design, never implemented). That doc is marked obsolete with a pointer to this one; kept as historical record, not deleted.

## 1. Overview

Add a "Generate questions" action on the interview detail view (same UX slot the superseded spec described). It calls a backend endpoint that runs a LangChain **tool-calling agent** — not a single-shot prompt — to produce 5–8 role-appropriate interview questions for the interview's `role` and `interviewType`.

The agent has access to one external tool source: the [`leetcode-mcp-server`](https://github.com/jinzcdev/leetcode-mcp-server), an unofficial MCP server wrapping LeetCode's problem-search API. The agent decides for itself — based on the interview's `role` text and `interviewType` — whether pulling a real LeetCode problem is appropriate (typically for `technical` interviews) or whether to rely purely on its own knowledge (typically for `behavioral`/`system-design`). This is a deliberate behavioral choice, not a hardcoded gate: no code branches on `interviewType` to decide tool eligibility.

Interviewer reviews and edits the generated list before saving — same review-before-persist UX as the superseded spec.

## 2. Goals / Non-goals

**Goals**
- One click → 5–8 high-quality, role-appropriate interview questions, personalized by the seniority and domain the agent infers from the interview's free-text `role` field (e.g. "Senior Backend Engineer" → biases toward medium/hard, backend-relevant topics).
- For technical rounds, questions can be grounded in real, verifiable LeetCode problems (via tool call) rather than purely LLM-invented ones — at the agent's own discretion.
- Interviewer can edit any field before saving.
- Saved questions persist on `Interview.questions` (already exists) and render in `InterviewRoom`.
- Graceful degradation: if the LeetCode MCP tool is unavailable, the agent still produces questions from its own knowledge — no hard failure.

**Non-goals**
- A deterministic seniority/domain parser in our own code. The agent infers this itself from `role` text as part of its reasoning; we do not pre-parse or store a separate `seniority`/`domain` field.
- Verbatim reproduction of LeetCode's copyrighted problem descriptions into our database (see §9).
- Exposing LeetCode's user-profile/submission/auth-required tools — only the public, no-auth problem-search tools are made available to the agent.
- Streaming responses.
- Per-question scoring or candidate feedback (that's sub-project 3, the judge agent).
- Multi-language prompts.
- The judge agent (sub-project 3).

## 3. Data model

None. Reuses `Interview.questions Json?`, already added by sub-project 1 (migration `add_code_and_questions`, already applied and merged). No new migration.

## 4. Backend

### 4.1 LeetCode MCP client — `backend/src/lib/agents/leetcodeMcpClient.js`

A singleton wrapper around `@langchain/mcp-adapters`'s `MultiServerMCPClient`, connected once at server startup (not per-request — spawning the MCP server subprocess on every HTTP request would add unacceptable latency).

Behavior:
- Configures one server entry, `leetcode`, with `transport: "stdio"`, `command: "npx"`, `args: ["-y", "@jinzcdev/leetcode-mcp-server", "--site", "global"]` (no session cookie — only public, unauthenticated tools are needed).
- On startup, calls `client.getTools()` and filters the result down to an **allowlist**: `get_daily_challenge`, `get_problem`, `search_problems`. The server also exposes user-profile/submission tools that require a LeetCode session cookie we don't have and don't want the agent reaching for — these are dropped, not passed to the agent.
- If connecting or fetching tools fails (subprocess spawn error, timeout, protocol mismatch), the error is caught and logged; the exported tool list is simply empty (`[]`) rather than throwing. This is the mechanism behind the "graceful degradation" goal — the rest of the app never knows or cares whether LeetCode tools are available.
- Exports `getLeetCodeTools(): Promise<StructuredTool[]>` — resolves to the filtered tool list (possibly empty), memoized after the first successful (or failed) connection attempt so subsequent calls don't re-spawn the subprocess.

### 4.2 Question-generator agent — `backend/src/lib/agents/questionGeneratorAgent.js`

Built with LangChain's `createAgent` (the current unified agent API — verified against live LangChain.js docs via context7, not assumed from training data).

```js
import { createAgent } from "langchain";
```

Exports:
- `generateInterviewQuestions({ role, interviewType, count }) → Promise<Question[]>`

Behavior:
- Reads `OPENAI_API_KEY`, `AI_MODEL` (default `gpt-4o-mini`), `AI_QUESTION_COUNT` (default `6`) from env — same config surface as the superseded spec.
- Fetches `getLeetCodeTools()` (may be `[]`) and constructs the agent with `createAgent({ model: "openai:" + AI_MODEL, tools, prompt: SYSTEM_PROMPT })`.
- `SYSTEM_PROMPT` (in `backend/src/lib/agents/prompts/questionGenerator.js`, mirroring the superseded spec's separate-prompt-file convention) instructs the agent to:
  - Infer seniority (junior/mid/senior/staff+) and domain (backend/frontend/full-stack/data/mobile/etc.) from the `role` string.
  - Use that inference to bias difficulty and topic choices — junior skews easy, staff+ skews hard; domain steers topic relevance.
  - For interviews where a concrete coding problem would help (typically `technical`), consider calling `search_problems` or `get_problem` to ground one or more questions in a real, well-known problem — entirely the agent's judgment call, not gated by our code on `interviewType`.
  - When referencing a LeetCode-sourced problem, **paraphrase the question text** in its own words (name the problem and topic, describe the task) rather than copying the tool's returned description verbatim (see §9).
  - Respond with a final message that is a single JSON object: `{ "questions": [ { "text": string, "category": "technical"|"behavioral"|"system-design", "difficulty": "easy"|"medium"|"hard" } ] }`, no prose outside the JSON.
- Invokes the agent: `await agent.invoke({ messages: [{ role: "user", content: buildUserMessage({ role, interviewType, count }) }] })`.
- Takes the content of the last message in the response, parses it as JSON, and validates it with the same shape-validation logic as the superseded spec (array length, allowed `category`/`difficulty` enums) — reused/ported, not redesigned.
- Throws the same typed errors as the superseded spec's `ai.js` (`AIConfigError`, `AIProviderError`, `AIInvalidResponseError`) so the existing error-to-HTTP-status mapping still applies unchanged.

### 4.3 Route and controller — unchanged shape from the superseded spec

`POST /api/interviews/:id/questions/generate`, wired in `backend/src/routes/interview.routes.js`, handled by `backend/src/controllers/aiController.js` (or equivalent) — same contract as the superseded spec's §4.2–4.4: loads the interview, checks the rate limiter, calls the generator (now `generateInterviewQuestions` from the new agent module instead of the old single-shot `ai.js`), returns the array without auto-saving. Same rate limiter (10 generations/hour per `clerkId`, in-memory), same error-status mapping (404/429/502/500).

`PATCH /api/interviews/:id` already accepts `questions` (added alongside the `questions` column in sub-project 1's plan — actually not yet built; this sub-project's plan will need to add the save-path validation, since sub-project 1 only added the column, not the save endpoint's field acceptance). Flagged for the implementation plan.

### 4.4 Configuration

`backend/.env` / `.env.example` — same three variables as the superseded spec:
```
OPENAI_API_KEY=
AI_MODEL=gpt-4o-mini
AI_QUESTION_COUNT=6
```
No new LeetCode-specific env var — the MCP server needs no credentials for the tools we use.

## 5. Frontend

Unchanged from the superseded spec's §5: a "Generate questions" button and editable questions panel on `InterviewRoom.tsx` (or wherever the interview detail view lives), calling the same endpoint, rendering the same `Question[]` shape. No new frontend design work in this spec — it's covered by porting the superseded spec's frontend section verbatim into the implementation plan.

## 6. Error handling

| Failure | Response |
|---|---|
| Interview not found | 404 |
| Missing `OPENAI_API_KEY` at call time | 500, `"AI not configured"` |
| LeetCode MCP tool connection fails | No error surfaced — agent runs with `tools: []`, degrades to pure-LLM generation |
| Agent's LLM call fails (network, 5xx, timeout) | 502 |
| Agent's final message isn't valid/parseable JSON or fails schema validation | 502 |
| Rate limit exceeded | 429 with `retryAfter` |
| Saving invalid `questions` payload via PATCH | 400 |

## 7. Testing

**Backend (unit)**
- `leetcodeMcpClient.js`: mock `MultiServerMCPClient` — happy path returns the filtered allowlist tools; connection-failure path returns `[]` without throwing.
- `questionGeneratorAgent.js`: mock `createAgent`'s returned agent object's `.invoke()` — happy path returns parsed/validated questions; invalid-JSON-final-message path throws `AIInvalidResponseError`; agent-invoke-rejects path throws `AIProviderError`. Test both with `tools: []` (no LeetCode) and with a mocked non-empty tool list, to confirm the module doesn't behave differently based on tool availability beyond what the agent itself decides.

**Backend (route)** — same shape as the superseded spec's §8: 200/404/502/429 paths on the generate endpoint; 200/400 on the PATCH save path.

**Frontend (smoke)** — same as superseded spec: generate renders rows, edit+save persists.

## 8. Out of scope (recorded so we don't re-litigate)

- Deterministic seniority/domain parsing code — the agent infers this itself.
- A judge/evaluation agent (sub-project 3).
- Exposing any LeetCode tool beyond the three-tool allowlist.
- Caching or pre-fetching LeetCode problems.
- Handling LeetCode's `cn` (China) site variant — `global` only.

## 9. Legal / content note

LeetCode problem descriptions are copyrighted content. The agent is instructed (§4.2) to use tool results as grounding/inspiration — real problem name, difficulty, topic — and to paraphrase its own interview-question text rather than copy the tool's returned description verbatim into `Interview.questions`. This is a prompt-level instruction, not a code-enforced guarantee; if this proves insufficient in practice (e.g. the agent quotes verbatim anyway), a follow-up could add a similarity check against the tool's raw output before saving — explicitly deferred rather than built preemptively (YAGNI).

## 10. Future extension notes

- Sub-project 3 (judge agent) will read `Interview.questions` (populated by this feature) alongside `codeSnapshot`/`notes` as evidence.
- If a future need arises to query across all generated questions (e.g. "show me every LeetCode-sourced question ever generated"), that would motivate moving off the `Json` column to a relational table — not needed now.

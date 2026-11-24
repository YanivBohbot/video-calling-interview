# AI folder restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `backend/src/agents/` to `backend/src/ai/` organised by kind (agents, workflows, tools, prompts, middleware), with no behaviour change.

**Architecture:** Pure move with `git mv` + import rewrites; the existing 424 backend tests are the proof. The architecture guard (`tests/architecture/aiWiring.test.js`) is rewritten for the new tree and gains a one-way dependency rule. Then a LangChain-docs conformance pass.

**Tech Stack:** Node ESM, langchain 1.x (`createAgent`), @langchain/langgraph (`StateGraph`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-ai-folder-restructure-design.md`

## Global Constraints

- No behaviour change: same exports, same factory names (`createPracticeInterviewer`, `createPracticeCoach`, `createQuestionGenerator`, `workflow`, `createQuestionModels`, `leetcodeUrl`, `createCheckpointer`, the 4 AI errors, `PracticeReportSchema`, `reportFormat`).
- Nothing under `src/ai/` imports Prisma (`lib/db.js`), `src/integrations/` or reads `process.env`.
- Outside `src/ai/` (and `src/tests/ai/`), code imports only `ai/agents/<x>/index.js`, `ai/workflows/<x>/index.js` or `ai/checkpointer.js`.
- `tools/`, `prompts/`, `middleware/` never import from `agents/` or `workflows/`.
- Old docs under `docs/superpowers/` are not rewritten.

## Review Focus

- A stale import left pointing at `src/agents/` → `npm test` fails to load; check `grep -rn "agents/" src --include=*.js` only hits `ai/agents/`.
- `git mv` must be used so history follows the files (`git log --follow` works).
- Windows paths in the architecture test: normalise `path.sep` to `/` before matching (the current test already does it for one helper; apply it to every helper).
- The checkpointer is now imported directly by `container.js` — the "index.js only" rule must allow exactly `ai/checkpointer.js`, nothing else.
- Prompt tests (`practiceInterviewer/prompts.test.js`) must follow the prompt to `tests/ai/prompts/interviewer.test.js`.

---

## File map (old → new, all under `backend/src/`)

| Old | New |
|---|---|
| `agents/middleware/*` | `ai/middleware/*` (unchanged names) |
| `agents/tools/code/runCode.js` | `ai/tools/runCode.js` |
| `agents/tools/leetcode/findProblem.js` | `ai/tools/findProblem.js` |
| `agents/tools/practice/readCandidateCode.js` | `ai/tools/readCandidateCode.js` |
| `agents/tools/practice/endSession.js` | `ai/tools/endSession.js` |
| `agents/tools/index.js` | `ai/tools/index.js` |
| `agents/practiceInterviewer/prompts.js` | `ai/prompts/interviewer.js` |
| `agents/practiceCoach/prompts.js` | `ai/prompts/coach.js` |
| `agents/questionGenerator/llm/prompts.js` | `ai/prompts/questionGenerator.js` |
| — | `ai/prompts/index.js` (re-exports the three) |
| `agents/practiceInterviewer/{agent,events,messages,repair,index}.js`, `README.md` | `ai/agents/interviewer/…` |
| `agents/practiceCoach/{agent,report,index}.js` | `ai/agents/coach/…` |
| `agents/questionGenerator/graph/{workflow,state}.js` | `ai/workflows/questionGenerator/{workflow,state}.js` |
| `agents/questionGenerator/graph/nodes/*` | `ai/workflows/questionGenerator/nodes/*` |
| `agents/questionGenerator/llm/models.js` | `ai/workflows/questionGenerator/models.js` |
| `agents/questionGenerator/tools/leetcode/sources.js` | `ai/workflows/questionGenerator/sources.js` |
| `agents/questionGenerator/execution/generator.js` | `ai/workflows/questionGenerator/generator.js` |
| `agents/questionGenerator/execution/checkpointer.js` | `ai/checkpointer.js` |
| `agents/questionGenerator/{errors,index}.js`, `README.md` | `ai/workflows/questionGenerator/…` |

Tests: `tests/agents/**` → `tests/ai/**` mirroring the table (e.g. `tests/agents/tools/code/runCode.test.js` → `tests/ai/tools/runCode.test.js`, `tests/agents/questionGenerator/graph/nodes/nodes.test.js` → `tests/ai/workflows/questionGenerator/nodes/nodes.test.js`, `tests/agents/questionGenerator/execution/checkpointer.test.js` → `tests/ai/checkpointer.test.js`, `tests/agents/practiceInterviewer/prompts.test.js` → `tests/ai/prompts/interviewer.test.js`).

---

### Task 1: Move the code and its tests

**Files:** every row of the file map; Modify `container.js`, `services/question.service.js`, `validators/question.validation.js`, `tests/http/questions.test.js`, `tests/architecture/aiWiring.test.js` (paths only in this task).

**Interfaces:**
- Produces: `ai/agents/interviewer/index.js` → `createPracticeInterviewer`; `ai/agents/coach/index.js` → `createPracticeCoach`, `CoachFailedError`, `PracticeReportSchema`, `reportFormat`; `ai/workflows/questionGenerator/index.js` → `workflow`, `createQuestionModels`, `leetcodeUrl`, `createQuestionGenerator`, the 4 errors (no longer `createCheckpointer`); `ai/checkpointer.js` → `createCheckpointer`; `ai/prompts/index.js` → `buildInterviewerPrompt`, `buildQuestionSwitchNote`, `COACH_PROMPT`, `buildCoachInput`, `buildResearcherPrompt`, `buildDrafterPrompt`.

- [ ] **Step 1:** Baseline: `cd backend && npm test` → 424 passed.
- [ ] **Step 2:** `git mv` every file per the map (code and tests), then remove the empty `src/agents/` and `src/tests/agents/` dirs.
- [ ] **Step 3:** Write `ai/prompts/index.js`; agents and `models.js` import prompts from `../../prompts/index.js`; fix every relative import (tools `../tools/index.js` → `../../tools/index.js`, middleware likewise, nodes `../../tools/leetcode/sources.js` → `../sources.js`, `../../errors.js` → `../errors.js`, etc.). `container.js` imports `createCheckpointer` from `./ai/checkpointer.js`.
- [ ] **Step 4:** Update the header comment of `ai/workflows/questionGenerator/index.js` to the flat layout.
- [ ] **Step 5:** Verify: `grep -rn "agents/" src --include=*.js | grep -v "ai/agents/"` → only comments, no imports; `npm test` → 424 passed.
- [ ] **Step 6:** Commit `refactor(ai): move src/agents to src/ai (agents, workflows, tools, prompts, middleware)`.

### Task 2: Architecture guard for the new tree

**Files:** Modify `tests/architecture/aiWiring.test.js`.

- [ ] **Step 1: Rewrite the rules over `src/ai/`** (normalise `path.sep` to `/` in every file walk):
  - `"nothing in ai/ imports Prisma or reads process.env"` — regex `/lib\/db\.js|process\.env/`.
  - `"nothing in ai/ imports integrations/"`.
  - `it.each(["agents/interviewer", "agents/coach", "workflows/questionGenerator"])("the rest of the backend reaches ai/%s only through its index.js")` — every `from "…ai/<x>…"` in files outside `ai/` and `tests/ai/` must end in `ai/<x>/index.js`.
  - `"outside code imports ai/ only through an agent/workflow index.js or ai/checkpointer.js"` — every import target containing `/ai/` outside `ai/`, `tests/ai/` matches `/ai\/(agents|workflows)\/[^/]+\/index\.js$|ai\/checkpointer\.js$/`.
  - `"tools, prompts and middleware never import an agent or a workflow"` — files under `ai/{tools,prompts,middleware}/` contain no import matching `/(agents|workflows)\//`.
  - Keep the existing tool-folder check (line ~77) pointed at `ai/tools`.
- [ ] **Step 2: Prove the new rule bites:** temporarily add `import "../agents/coach/index.js";` to `ai/tools/index.js`, run `npx vitest run src/tests/architecture` → FAIL on the new rule; remove it → PASS.
- [ ] **Step 3:** `npm test` → all pass (424 + new rules).
- [ ] **Step 4:** Commit `test(ai): architecture rules for the src/ai layout`.

### Task 3: Docs — the map

**Files:** Create `ai/README.md`; Modify `ai/workflows/questionGenerator/README.md`, `ai/agents/interviewer/README.md`, `CLAUDE.md` (repo root).

- [ ] **Step 1:** `ai/README.md` (≤ 60 lines): what an agent is here (`createAgent`, the model chooses the next step) vs a workflow (`StateGraph`, fixed steps); the tree; for each agent/workflow one line + its tools + its prompt file; the dependency rules from Task 2; where tests live.
- [ ] **Step 2:** Update the two existing READMEs to the new paths (questionGenerator layout diagram becomes flat; tests path `src/tests/ai/workflows/questionGenerator/`).
- [ ] **Step 3:** `CLAUDE.md`: in the backend layout block replace the `agents/` line with `ai/` (agents/, workflows/, tools/, prompts/, middleware/, checkpointer.js); rewrite the "AI question generator" tree and the "AI interviewer" agent block with new paths; agent tests now in `src/tests/ai/` (same tree); fix `aiWiring.test.js` description.
- [ ] **Step 4:** `grep -n "src/agents\|agents/questionGenerator\|agents/practice" ../CLAUDE.md backend/src -r` → no hits except history docs.
- [ ] **Step 5:** Commit `docs(ai): map of the src/ai folder`.

### Task 4: LangChain conformance pass

**Files:** any under `ai/` (only for minor fixes); results appended to the spec under `## Conformance findings`.

- [ ] **Step 1:** Read current docs (context7: `langchain` JS — `createAgent`, `createMiddleware` hooks, `dynamicSystemPromptMiddleware`, `toolStrategy`/`responseFormat`, `tool()`; `@langchain/langgraph` JS — `StateSchema`, `StateGraph`, `interrupt`/`Command`, `PostgresSaver`). Compare with `ai/agents/*/agent.js`, `ai/middleware/*`, `ai/tools/*`, `ai/workflows/questionGenerator/{workflow,state,nodes/humanApproval,generator}.js`.
- [ ] **Step 2:** Write findings to the spec: each as *conformant / minor (fixed) / behaviour-changing (for the user)*.
- [ ] **Step 3:** Fix the minor ones; `npm test` → all pass.
- [ ] **Step 4:** Commit `refactor(ai): align with LangChain docs` (or `docs(ai): conformance findings` if nothing changed). Report behaviour-changing findings to the user before touching them.

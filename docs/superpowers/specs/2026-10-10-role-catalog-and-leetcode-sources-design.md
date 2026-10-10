# Role Catalog, Visible LeetCode Sources, Better Research — Design

**Date:** 2026-10-10
**Status:** Approved in conversation (pending user review of written spec)
**Builds on:** `2026-10-10-question-generator-langgraph-pipeline-design.md` (same branch, `feat/question-generator-langgraph`).

## 1. Why

User QA on the running app found three gaps:

1. **No predefined roles.** New Interview has a free-text role field (`NewInterview.tsx:278`). The 18-role catalog the user remembers lives only on the unmerged `worktree-ai-avatar-interviewer` branch (`practiceTemplatesData.js`, commit `ed842f5`), and even there it feeds the `/practice` screen, not New Interview.
2. **LeetCode grounding is invisible.** Live runs showed drafts *are* built on real problems (Second Highest Salary, Rank Scores, Add Two Numbers…), but the drafter is told to paraphrase and never name them, and a question has no field to carry its source — so it looks identical to an invented question.
3. **Research quality.** One live run spent all 4 technical slots on one problem and bled it into the system-design question; research tends to pick generic first-page problems (Add Two Numbers) regardless of role; with the same filters `search_problems` always returns the same first results, so Regenerate repeats problems.

## 2. Goals / Non-goals

**Goals**
- New Interview offers the 18 catalog roles in a dropdown plus "Custom…" free text.
- A question grounded in a LeetCode problem shows a badge — title, difficulty, link — in the Questions tab.
- Each technical question uses a different problem; behavioral and system-design questions never carry a LeetCode source.
- Research picks problems relevant to the role, and Regenerate can surface different problems.

**Non-goals**
- Merging the avatar/practice branch (it also brings HeyGen, Deepgram, new tables). Only the role *titles* are ported.
- Storing the role as a structured `{domain, seniority}` — `Interview.role` stays a plain string; no migration.
- Problem numbers in the badge (`search_problems` doesn't return them; an extra `get_problem` call per problem isn't worth the latency).
- Copying problem descriptions — question text stays paraphrased; only the title/difficulty/link (facts) are shown.

## 3. Role catalog (frontend only)

- New `frontend/src/lib/roleCatalog.ts`: the same 6 domains × 3 seniorities as the avatar branch → 18 titles like `"Senior Backend Engineer"`.
- `NewInterview.tsx` role field becomes a `<select>` of the 18 titles grouped by domain, plus a final `Custom…` option that reveals the existing free-text input. Submitted value is still `role: string`. No backend change.

## 4. Question source (backend contract + UI)

**Shape** — a question gains an optional `source`:
```json
{ "text": "...", "category": "technical", "difficulty": "medium",
  "source": { "type": "leetcode", "title": "Second Highest Salary", "slug": "second-highest-salary",
              "difficulty": "Medium", "url": "https://leetcode.com/problems/second-highest-salary/" } }
```
Stored in the existing `Interview.questions` JSON column — no migration. Old questions without `source` stay valid.

**Never trust the model for facts:** the drafter outputs only `sourceSlug` (string or null) per question. A deterministic step (`attachSources`) maps the slug to the research problem it came from and builds `source` — title/difficulty from the tool result, URL built from the slug. A slug not in the research list, or a slug on a non-technical question, is dropped (source = none).

**Validation:** `validateQuestionsPayload` (shared by PATCH and `/approve`) accepts an optional `source` and checks it: `type === "leetcode"`, non-empty `title`/`slug`, `url` exactly `https://leetcode.com/problems/<slug>/`. Anything else → 400. This also stops a client injecting arbitrary links.

**UI:** in `QuestionsPanel`, a row with `source` shows a small badge — `LeetCode · Second Highest Salary · Medium` — linking to `url` in a new tab (`rel="noopener noreferrer"`). The badge survives edits to the row's text/category/difficulty.

## 5. Research quality

**Researcher output** changes from `{usedLeetCode, notes}` to `{ problems: [{ title, slug, difficulty }] }` (via the existing `toolStrategy`).
- Prompt: given role + interview type + `technicalCount` (from the plan), choose `category`/`tags`/`keywords` that fit the role (e.g. backend → database, design, hash-table; frontend → javascript, string), and difficulty that fits the seniority in the role title; return up to `technicalCount` *distinct* problems on varied topics; don't use `get_daily_challenge`.
- Variety: the node passes a random `offset` hint (0–40) in the user message so repeated runs page to different results.
- **Anti-hallucination:** the node keeps only problems whose slug actually appeared in a `search_problems`/`get_problem` tool result during that run (read from the agent's tool messages). Max `technicalCount` problems, de-duplicated by slug.
- Graceful degradation unchanged: any failure → `research: []`, logged.

**Drafter:** receives the research list compactly (`slug — title (difficulty)`), told: use each problem for at most one *technical* question and set `sourceSlug` to it; never base behavioral or system-design questions on these problems (`sourceSlug: null`); paraphrase, don't copy descriptions.

**Validator** adds one rule: two questions sharing the same `source.slug` → content-invalid (retry loop, with the error fed back to the drafter as today).

## 6. Testing
- `roleCatalog`: 18 unique titles. Frontend has no test runner → verified by `npm run build` + lint baseline + a manual check.
- `attachSources`: known slug → full source with built URL; unknown slug → dropped; slug on a behavioral/system-design question → dropped.
- Researcher node: keeps only slugs seen in tool results; caps at `technicalCount`; de-dupes; failure → `[]`.
- Validator: duplicate `source.slug` → retry with error.
- `validateQuestionsPayload`: valid source passes; bad URL / wrong type / missing title → error; no source still passes.
- Live QA: 3 real technical runs — every technical question has a distinct LeetCode source with a working URL; no source on behavioral/system-design; badge visible in the UI.

## 7. Out of scope
- Problem numbers; LeetCode CN site; caching search results; editing/removing a source from the UI; seniority-aware difficulty for non-catalog custom roles beyond what the model infers from the text.

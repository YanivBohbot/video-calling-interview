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
- New Interview offers the 18 catalog roles via two short dropdowns (Domain + Seniority) plus "Custom…" free text.
- A question grounded in a LeetCode problem shows a badge — title, difficulty, link — in the Questions tab.
- Each technical question uses a different problem; behavioral and system-design questions never carry a LeetCode source.
- Research picks problems relevant to the role, and Regenerate can surface different problems.

**Non-goals**
- Merging the avatar/practice branch (it also brings HeyGen, Deepgram, new tables). Only the role *titles* are ported.
- Storing the role as a structured `{domain, seniority}` — `Interview.role` stays a plain string; no migration.
- Problem numbers in the badge (`search_problems` doesn't return them; an extra `get_problem` call per problem isn't worth the latency).
- Copying problem descriptions — question text stays paraphrased; only the title/difficulty/link (facts) are shown.

## 3. Role catalog (frontend only)

- New `frontend/src/lib/roleCatalog.ts`: the same 6 domains (Backend, Frontend, Full-Stack, Data/ML, Product Manager, DevOps) and 3 seniorities (Junior, Mid-level, Senior) as the avatar branch, plus `composeRole(seniority, domain)` → e.g. `"Senior Backend Engineer"`.
- `NewInterview.tsx` role field becomes **two short dropdowns side by side** — Domain (6 options + `Custom…`) and Seniority (3 options) — instead of one 18-item list, so nothing is too long to display. Choosing `Custom…` hides the Seniority dropdown and reveals the existing free-text input. Default: `Backend Engineer` + `Mid-level`.
- Submitted value is still `role: string` (the composed title, or the custom text). No backend change.

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

> **Revised during implementation (live QA).** The first version let a tool-calling agent run the searches. In live runs it ignored the offset, repeated generic problems, and hit the step limit in 3 of 7 runs (one run took 76s). The mechanism below replaced it; the goals are unchanged.

**The model chooses the search; code runs it.**
- One structured model call (no tools bound) returns `SearchQuerySchema = { category, tags (≤3), difficulty }`. Its enums are subsets of the LeetCode MCP `search_problems` enums, so the choice is always a valid tool input. The prompt maps roles to categories and tags (e.g. backend → database/algorithms + hash-table/design) and seniority to difficulty.
- Code calls `search_problems` with `limit = technicalCount × 3` and a random `offset` of 0–20.
- **Broadening ladder:** if results are thin, code tries again with the same filters at offset 0, then category + difficulty only, then algorithms + difficulty. Results accumulate across steps, de-duplicated, until there are `technicalCount` problems.
- Code then randomly samples `technicalCount` distinct problems, so Regenerate gives different ones.
- **Anti-hallucination by construction:** research titles, slugs and difficulties come only from the search output (`parseSearchProblems`). The model never supplies them.
- Graceful degradation unchanged: any failure → `research: []`, logged.

**Drafter:** receives the research list compactly (`slug — title (difficulty)`), told: use each problem for at most one *technical* question and set `sourceSlug` to it; never base behavioral or system-design questions on these problems (`sourceSlug: null`); paraphrase, don't copy descriptions.

**Validator** adds two rules: two questions sharing the same `source.slug` → content-invalid; the category mix differs from the plan → content-invalid (live QA saw a planned technical slot drafted as system-design). Both go through the retry loop, with the error fed back to the drafter as today.

## 6. Testing
- `roleCatalog`: 6 domains × 3 seniorities compose to 18 unique titles. Frontend has no test runner → verified by `npm run build` + lint baseline + a manual check.
- `attachSources`: known slug → full source with built URL; unknown slug → dropped; slug on a behavioral/system-design question → dropped.
- Researcher node: keeps only slugs seen in tool results; caps at `technicalCount`; de-dupes; failure → `[]`.
- Validator: duplicate `source.slug` → retry with error.
- `validateQuestionsPayload`: valid source passes; bad URL / wrong type / missing title → error; no source still passes.
- Live QA: 3 real technical runs — every technical question has a distinct LeetCode source with a working URL; no source on behavioral/system-design; badge visible in the UI.

## 7. Out of scope
- Problem numbers; LeetCode CN site; caching search results; editing/removing a source from the UI; seniority-aware difficulty for non-catalog custom roles beyond what the model infers from the text.

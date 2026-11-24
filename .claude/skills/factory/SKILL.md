---
name: factory
description: Run features through a small multi-agent build/review/approve pipeline. Trigger on /factory.
---

# /factory — software factory orchestrator

Whichever session runs this skill is the **orchestrator**. It runs the loop below,
spawns every agent, and is the **only** writer of `factory/board.json`. Agents read
files, not the conversation, and write only their own file — the orchestrator never
writes an agent's markdown file for it.

## Config

```
MAIN_BRANCH   = master
MAX_ROUNDS    = 2            # see "Round cap" below
REVIEWERS     = security, ux, ui, code
REPO TEST     = cd backend && npm test   (31 passing baseline — never regress)
REPO LINT     = cd frontend && npm run lint (5 pre-existing errors baseline — don't
                 regress unrelated files, but don't need to fix them either)
```

Load `SendMessage` before resuming any builder: `ToolSearch("select:SendMessage")`.

## The loop

```
                   ┌──────────────────┐
                   │     feature      │
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │   spec-writer    │
                   │       opus       │
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │     builder      │◄────────────────────┐
                   │       opus       │                     │
                   └─────────┬────────┘                     │
        ┌─────────────┬──────┴──────┬─────────────┐         │
        ▼             ▼             ▼             ▼         │
  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
  │  security │ │     ux    │ │ ui design │ │    code   │   │
  │    opus   │ │   sonnet  │ │   sonnet  │ │   sonnet  │   │
  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘   │
        └─────────────┴──────┬──────┴─────────────┘         │
                             ▼ WAIT FOR ALL                 │
                   ┌──────────────────┐   any CHANGES       │
                   │   4 reviews in   ├─────────────────────┘
                   │   this round     │   (round < MAX_ROUNDS)
                   └─────────┬────────┘   resume builder
                             ▼ all PASS, or round == MAX_ROUNDS
                   ┌──────────────────┐
                   │     approver     │
                   │       opus       │
                   └─┬───────────────┬┘
             APPROVE │               │ ESCALATE
                     ▼               ▼
              ┌─────────────┐ ┌─────────────┐
              │merge to main│ │ needs-human │ ◄── /factory approve
              └─────────────┘ └─────────────┘
```

Edit this diagram to change the factory — it is the source of truth, not the prose
below.

## Steps, in order

1. **New job.** Pick the next free id `NNN-slug` (3-digit, zero-padded, next after
   the highest existing job folder). Create `factory/jobs/<id>/`. Branch name is
   `factory/<id>`. Add a job entry to `board.json` with `stage: "spec"`.
2. **spec-writer.** Spawn with `subagent_type: "spec-writer"`, given the feature
   text and the job id. It writes `factory/jobs/<id>/spec.md`. Set
   `stage: "build"` when the file exists.
3. **builder, round 1.** Spawn with `subagent_type: "builder"`, named
   `builder-<id>`, pointed at `spec.md`. It
   creates branch `factory/<id>` off `MAIN_BRANCH`, implements, runs the repo test
   command, and commits. It appends a `## Round 1` section to `build.md`. Record
   the returned agent id/name in `board.json.jobs[].builderAgent`. Set
   `stage: "review"`, `round: 1`.
4. **Review round.** Create `factory/jobs/<id>/round-<round>/`. Before spawning,
   reset `board.json.jobs[].reviews` to `{security:"pending", ux:"pending",
   ui:"pending", code:"pending"}` — otherwise the dashboard and this round would
   show the previous round's verdicts. In **one message**, spawn all four
   reviewers in parallel, each pointed at `git diff MAIN_BRANCH...factory/<id>` —
   not the whole repo — plus `spec.md` and `build.md`:

   | chip key | `subagent_type` | writes |
   |---|---|---|
   | `security` | `security-reviewer` | `review-security.md` |
   | `ux` | `ux-reviewer` | `review-ux.md` |
   | `ui` | `ui-reviewer` | `review-ui.md` |
   | `code` | `code-reviewer` | `review-code.md` |

   Each writes `review-<name>.md` starting with `VERDICT: PASS` or
   `VERDICT: CHANGES`.
   - **WAIT FOR ALL**: a round is done only when all four files exist. Never resume
     the builder mid-round, even if some verdicts are in. Because all four run in
     one parallel message, they return together — there is no "live" update
     mid-round; `board.json.jobs[].reviews` only changes once, after all four
     return (the dashboard itself probes the files directly while waiting — see
     Dashboard below — so this is fine).
   - If a reviewer's file is missing or malformed after it returns, re-spawn that
     one reviewer once. Still malformed → treat as `CHANGES`.
   - A reviewer on a diff outside its domain (e.g. ux/ui on a backend-only diff)
     still writes its file: `VERDICT: PASS` with `N/A — no frontend changes`.
   - Read every verdict from the first line of the file, never from the spawning
     agent's chat reply.
   - Once all four are in: write them into `board.json.jobs[].reviews`, and push
     `{ round, reviews }` into `jobs[].rounds[]`.
5. **Round cap.** `MAX_ROUNDS = 2` means at most 2 *review* rounds run. If round 1
   has any `CHANGES` and `round < MAX_ROUNDS`: resume the same builder with
   `SendMessage`, pointing it at the `round-<round>/` folder; it appends
   `## Round <round+1>` to `build.md`; go back to step 4 with `round += 1`. If
   round `== MAX_ROUNDS` and still has `CHANGES`, do **not** resume the builder —
   go straight to step 6. The approver always runs, and will ESCALATE if reviews
   aren't all PASS. Every job that reaches needs-human therefore has a
   `decision.md`.
6. **approver.** Set `stage: "approve"` first. Spawn with
   `subagent_type: "approver"`, pointed at `spec.md`, `build.md`, and every round
   folder. It writes `factory/jobs/<id>/decision.md` starting with `APPROVE` or
   `ESCALATE`, plus the reasoning. Escalate automatically (tell the approver this
   explicitly) on any `schema.prisma` change, new dependency, or migration — the
   builder must never run `db:migrate` against the shared dev database.
7. **On APPROVE:** `git checkout MAIN_BRANCH`, `git merge --no-ff factory/<id>`.
   A merge conflict is treated as `needs-human`, not resolved by the orchestrator.
   Never `git push`. Set `stage: "done"`.
   **On ESCALATE:** set `stage: "needs-human"`. The job stays until
   `/factory approve <job-id>`.

## Builder resume across sessions

The builder agent may not exist anymore (new session for `/factory approve` or
`/factory rework`). If `SendMessage` to `builderAgent` fails to find it, spawn a
fresh agent named `builder-<id>` and point it at `spec.md`, `build.md`, and the
latest round/rework file — it re-reads `build.md` for history and
`git checkout factory/<id>` to resume. `build.md` is append-only: one `##` section
per round, never rewritten.

## Git hygiene (shared working tree)

- Only one job runs at a time.
- The builder stages **explicit paths**, never `git add -A`, and never stages
  `factory/` or `.claude/` — those are the factory's own files, not the feature's.
- The builder re-runs `git checkout factory/<id>` at the start of every resume,
  in case the tree moved.
- The orchestrator returns to `MAIN_BRANCH` before merging.

## Commands

- `/factory <feature>` — run a new job through the loop (step 1).
- `/factory next` — take the first unchecked `- [ ]` line in `factory/backlog.md`,
  check it off, use it as `<feature>`, then run step 1.
- `/factory approve <job-id>` — resume a `needs-human` job: merge it as if the
  approver had said APPROVE (step 7, APPROVE branch).
- `/factory rework <job-id> <note>` — write `<note>` verbatim to
  `factory/jobs/<job-id>/rework-<n>.md` (n = next integer), then resume the builder
  (step 3 logic) and run a fresh review round at `round += 1`, ignoring the round
  cap (a human asked for this one).

## board.json

The orchestrator creates this file if missing: `{"jobs": []}`. Schema per job:

```json
{
  "id": "003-rate-limiting",
  "feature": "add rate limiting to the interview question generator",
  "branch": "factory/003-rate-limiting",
  "stage": "review",
  "round": 2,
  "builderAgent": "builder-003-rate-limiting",
  "reviews": { "security": "CHANGES", "ux": "PASS", "ui": "pending", "code": "PASS" },
  "rounds": [
    { "round": 1, "reviews": { "security": "CHANGES", "ux": "PASS", "ui": "PASS", "code": "CHANGES" } }
  ],
  "decision": null,
  "updated": "2026-10-10T17:20:00Z"
}
```

`stage` is one of `spec`, `build`, `review`, `approve`, `done`, `needs-human`.
`decision` is `null`, `"APPROVE"`, or `"ESCALATE"`. Update `updated` on every write.
The dashboard derives file paths itself from `id` and `round` — it never needs a
file list in `board.json`.

## Dashboard

`factory/dashboard.html` is static and self-contained — serve it with
`python3 -m http.server` (or `python`/`py`) from `factory/`, then open
`http://localhost:8000/dashboard.html`. It polls `board.json` on a timer.

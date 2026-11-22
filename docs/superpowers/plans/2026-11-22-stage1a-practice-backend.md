# Étape 1a — Entraînement IA, backend (lien, agents, API SSE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un intervieweur crée un lien d'entraînement ; le candidat, avec ce lien, ouvre une séance où un agent LangChain autonome lui présente un problème, lit et exécute son code, le relance ; à la fin un agent coach produit un bilan structuré. Tout est testable sans clé (faux modèle) via Supertest.

**Architecture:** Deux agents `createAgent` indépendants (`agents/practiceInterviewer/`, `agents/practiceCoach/`) qui partagent des outils (`agents/tools/`) et des middlewares (`agents/middleware/`). Les clients Piston / LeetCode sont injectés par `container.js` sous forme de fonctions (`runCode`, `searchProblems`) ; les agents n'importent ni Prisma, ni `process.env`, ni `integrations/`. Un nouveau principal `practice` n'est résolu **que** sur `/api/practice/*` (authentificateur dédié), donc il ne peut atteindre aucune autre route ni socket. La conversation vit dans le checkpointer Postgres existant (`thread_id = practice:<sessionId>`), la séance dans une table `practice_sessions`.

**Tech Stack:** Express 5 ESM, Prisma 6.19 / Postgres, zod 3, LangChain 1.5.4 (`createAgent`, `tool`, `toolStrategy`, `modelCallLimitMiddleware`, `toolCallLimitMiddleware`, `modelFallbackMiddleware`, `createMiddleware`, `fakeModel`), LangGraph 1.4 (`PostgresSaver`, `MemorySaver` en test), vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-11-22-practice-interviewer-design.md` (section « Conception — étape 1 »). La page frontend (`/practice/:id`) est le plan 1b, écrit après celui-ci.

## Global Constraints

- Couches : routes → controllers → services → repositories ; factories à dépendances injectées ; erreurs = `AppError` ; `handle("<message>", fn)` dans les controllers, jamais `err.message` dans une réponse.
- Les agents n'importent ni Prisma, ni `process.env`, ni `integrations/` ; le reste du backend n'importe un agent que par son `index.js` ; `agents/tools/` et `agents/middleware/` ne sont importés que depuis `agents/`.
- Un outil = un fichier, une factory, nom snake_case côté modèle, schéma zod avec `.describe()` sur chaque champ, description qui dit **quand** l'utiliser.
- Jamais d'énoncé LeetCode récupéré ni recopié : titre, slug, difficulté, lien seulement.
- Plafonds (valeurs exactes) : 3 séances par lien, lien valable 7 jours, séance 60 min, 60 messages par séance, 10 messages / min par lien, 30 exécutions / min par lien (`POST /api/practice/run` et outil `run_code` partagent la clé `practice:<interviewId>`).
- Par tour d'agent : intervieweur ≤ 6 appels modèle, ≤ 8 appels d'outils, `recursionLimit: 25` ; coach ≤ 8 appels modèle (les réponses structurées invalides coûtent un appel de plus), ≤ 10 appels d'outils, `recursionLimit: 40`.
- Migration : `prisma migrate diff` → fichier SQL écrit à la main dans `prisma/migrations/<timestamp>_practice/`, appliqué par `npx prisma migrate deploy`. **Jamais** `migrate reset`, **jamais** `npm run seed`.
- Ne jamais lire les valeurs de `.env` ; ne jamais committer `backend/.env.example` ni `.gitignore` ; pas de push ni de merge sans accord explicite.
- Branche : `feat/stage1-practice` (créée depuis `feat/stage0-foundations`).
- Modifications de chaînes contenant `\n` : outil Edit, jamais un script Python.

## Rulings (décisions prises en écrivant ce plan)

- **`getProblem(slug)` abandonné** : la spec le liste dans `integrations/leetcode` mais l'anti-objectif interdit les énoncés. `find_problem` ne renvoie que titre, difficulté, lien.
- **Principal `practice` isolé** : le résolveur générique (`fromRequest` / `fromCredentials`, utilisé par toutes les routes et les sockets) **ignore** `x-practice-token`. Seul `authenticatePractice`, monté sur `/api/practice`, le lit. Le bouton Run de la page d'entraînement passe par `POST /api/practice/run` (pas `/api/code/run`).
- **Expiration du lien** dans le résolveur (`practiceCreatedAt` + 7 jours, horloge `now` injectée), à côté du refus des entretiens `completed` / `cancelled`.
- **Code candidat** : envoyé avec chaque message, enregistré dans `PracticeSession.code` / `language` à chaque message (dans la même requête atomique que le compteur), lu par `read_candidate_code` depuis le contexte runtime.
- **`end_session` ne lance pas le coach** : l'outil répond seulement ; le service détecte son appel dans le tour, puis termine la séance et lance le bilan **après** la fermeture du flux.
- **Bilan honnête** : `run_code` (côté coach) numérote chaque exécution (`run-1`, `run-2`…) ; après l'agent, `testsRun` ne garde que les entrées dont le `runId` existe, et `actual` est remplacé par la sortie réellement obtenue.
- **Limite atteinte** : `modelCallLimitMiddleware({ exitBehavior: "end" })` ajoute un message IA « Model call limits exceeded… » (vérifié). `streamTurn` le signale par `done.limited = true` ; `history()` le filtre.
- **Un seul checkpointer** : `PostgresSaver` partagé avec le générateur de questions (construit paresseusement une seule fois dans `container.js`).
- **Coach et faux modèle** : `fakeModel().structuredResponse()` ne sert pas sous `createAgent` (vérifié). Le format est `toolStrategy(PracticeReportSchema)`, créé **une fois** dans `practiceCoach/report.js` et exporté (`reportFormat`) ; les tests appellent l'outil `reportFormat[0].name` (nom généré `extract-N`, jamais écrit en dur).
- **Déconnexion du candidat** : `req.on("close")` → `AbortController.abort()` → le flux de l'agent lève `AbortError` (vérifié) ; aucun événement n'est plus écrit.

## Review Focus

- Un jeton d'entraînement envoyé à une autre route (`/api/sessions`, `/api/stream/token`, `/api/interviews/:id/room`, `/api/code/run`) ou au socket → 401, jamais un accès ; tests en Task 2.
- Deux messages envoyés en même temps à 59/60 → un seul passe (compteur atomique) ; test en Task 8.
- Candidat qui ferme l'onglet pendant une réponse → l'agent s'arrête (pas de coût continu) ; test en Task 6.
- Coach qui invente un test jamais lancé → retiré du bilan ; test en Task 7.
- Séance laissée ouverte (onglet fermé) → au-delà de 60 min elle est traitée comme terminée et ne bloque pas la séance suivante ; test en Task 8.

---

### Task 1: Données — schéma, migration, dépôts

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20261122120000_practice/migration.sql`
- Create: `backend/src/repositories/practiceSession.repository.js`
- Modify: `backend/src/repositories/interview.repository.js`
- Modify: `backend/src/shared/mongoShape.js`
- Test: `backend/src/tests/repositories/practiceSession.repository.test.js`, `backend/src/tests/http/interviews.test.js`

**Interfaces:**
- Produces (`interview.repository`): `setPracticeHash(id, hash) → { id }` (met aussi `practiceCreatedAt = now`), `findByPracticeHash(hash) → { id, status, practiceCreatedAt, role, interviewType } | null`.
- Produces (`createPracticeSessionRepository({ prisma })`):
  - `create({ interviewId, language }) → session`
  - `findById(id) → session | null`
  - `findActive(interviewId) → session | null`
  - `countSince(interviewId, since: Date) → number`
  - `listForInterview(interviewId) → [{ id, status, startedAt, finishedAt }]` (jamais `code` ni `report`)
  - `claimMessage(id, { max, code, language }) → boolean` — `updateMany({ where: { id, status: "active", messageCount: { lt: max } }, data: { messageCount: { increment: 1 }, code, language } })`, vrai si `count === 1`
  - `finish(id) → boolean` — `updateMany` où `status: "active"` → `finished`, `finishedAt: now`
  - `saveReport(id, report) → void`
- Session = `{ id, interviewId, status: "active" | "finished", language, code, report, messageCount, startedAt, finishedAt }`.

- [ ] **Step 1: Écrire les tests du dépôt** (prisma simulé) : `claimMessage` renvoie `true` quand `updateMany` rend `{ count: 1 }`, `false` pour `{ count: 0 }`, et passe exactement le `where` ci-dessus ; `finish` ne vise que `status: "active"` ; `listForInterview` a un `select` sans `code` ni `report`.
- [ ] **Step 2: Test « les hash ne sortent jamais »** dans `tests/http/interviews.test.js` : `GET /api/interviews/:id` sur un entretien qui a `inviteTokenHash` et `practiceTokenHash` → la réponse n'a aucune des deux clés.
- [ ] **Step 3: Lancer** `npx vitest run src/tests/repositories src/tests/http/interviews.test.js` — Expected: FAIL (module absent, clés présentes).
- [ ] **Step 4: Schéma** : `Interview` + `practiceTokenHash String? @unique`, `practiceCreatedAt DateTime?`, `practiceSessions PracticeSession[]` ; modèle `PracticeSession` (champs ci-dessus, `status String @default("active")`, `messageCount Int @default(0)`, `startedAt DateTime @default(now())`, relation `onDelete: Cascade`, `@@index([interviewId])`, `@@map("practice_sessions")`).
- [ ] **Step 5: Migration** (sans base fantôme) : `git show HEAD:backend/prisma/schema.prisma > <scratch>/old.prisma` puis `npx prisma migrate diff --from-schema-datamodel <scratch>/old.prisma --to-schema-datamodel prisma/schema.prisma --script`, relire le SQL (ADD COLUMN ×2, index unique, CREATE TABLE, index, FK CASCADE et rien d'autre), l'écrire dans le fichier, puis `npx prisma migrate deploy` et `npx prisma generate`.
  Expected: « 1 migration applied » ; aucun DROP.
- [ ] **Step 6: Implémenter** le dépôt, les deux méthodes d'`interview.repository`, et dans `toInterviewDoc` retirer `inviteTokenHash` et `practiceTokenHash`.
- [ ] **Step 7: Lancer** `npm test` — Expected: PASS, suite entière.
- [ ] **Step 8: Commit** `feat(practice): practice link columns, practice_sessions table and repository`.

### Task 2: Authentification — principal `practice`, isolé sur `/api/practice`

**Files:**
- Modify: `backend/src/auth/principal.js`, `backend/src/auth/identityResolver.js`, `backend/src/auth/middleware.js`, `backend/src/services/code.service.js`
- Test: `backend/src/auth/identity.test.js`, `backend/src/tests/http/access.test.js`, `backend/src/tests/http/code.test.js`

**Interfaces:**
- Produces: `PRACTICE = "practice"` ; principal `{ kind: "practice", interviewId }`.
- Produces: `resolver.fromPracticeRequest(req) → principal | null` (lit seulement `x-practice-token`) ; `createIdentityResolver` gagne `now = () => Date.now()`.
- Produces: `authenticatePractice(resolver)` (même forme qu'`authenticate`, 401 « Unauthorized »).
- Le hash réutilise `hashInviteSecret` / `generateInviteSecret` d'`auth/inviteSecrets.js`.
- `PRACTICE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000`.

- [ ] **Step 1: Tests du résolveur** : jeton valide → `{ kind: "practice", interviewId: "iv-1" }` ; `practiceCreatedAt` il y a 7 jours + 1 ms → `null` ; statut `completed` ou `cancelled` → `null` ; `fromRequest` avec **seulement** `x-practice-token` → `null` et `findByPracticeHash` jamais appelé ; `fromCredentials({ practice })` n'existe pas (le socket ne peut pas s'en servir).
- [ ] **Step 2: Tests d'accès** (`access.test.js`, vraie app sans `identityResolver` de test, résolveur réel avec dépôts simulés) : avec seulement `x-practice-token` valide, `GET /api/sessions`, `GET /api/stream/token`, `GET /api/interviews/iv-1/room`, `POST /api/code/run` → 401.
- [ ] **Step 3: Test de clé de débit** (`code.test.js`) : deux principals `practice` d'entretiens différents ont chacun 30 exécutions ; un 31e appel du même lien → 429.
- [ ] **Step 4: Lancer** les trois fichiers — Expected: FAIL.
- [ ] **Step 5: Implémenter** ; `rateKeyFor` : `candidate:<id>`, `practice:<id>`, sinon `user:<userId>`.
- [ ] **Step 6: Lancer** `npm test` — Expected: PASS.
- [ ] **Step 7: Commit** `feat(auth): practice principal, resolved only on /api/practice, 7-day link`.

### Task 3: Lien d'entraînement côté intervieweur

**Files:**
- Modify: `backend/src/services/interview.service.js`, `backend/src/controllers/interview.controller.js`, `backend/src/routes/interview.routes.js`, `backend/src/container.js`
- Test: `backend/src/tests/http/practiceLink.test.js`

**Interfaces:**
- `POST /api/interviews/:id/practice` (owners) → 200 `{ url: "<clientUrl>/practice/<id>#practice=<secret>" }` ; régénérer remplace le hash.
- `GET /api/interviews/:id/practice` (owners) → 200 `{ createdAt: string | null, sessions: [{ startedAt, finishedAt, status }] }` — jamais de code, de message ni de bilan.
- `createInterviewService` gagne `practiceSessionRepository`.

- [ ] **Step 1: Tests** : propriétaire → url au bon format, `setPracticeHash` appelé avec le SHA-256 du secret de l'url ; autre intervieweur → 404 ; candidat → 403 ; démo autorisé ; `GET` renvoie les dates des séances et la réponse JSON ne contient ni `code`, ni `report`, ni `messageCount`.
- [ ] **Step 2: Lancer** — Expected: FAIL (404 route absente).
- [ ] **Step 3: Implémenter** `createPracticeLink(principal, id)` et `practiceUsage(principal, id)` (propriété vérifiée par `getOwned`).
- [ ] **Step 4: Lancer** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(practice): interviewer creates a practice link and sees only usage dates`.

### Task 4: Outils partagés (`agents/tools/`)

**Files:**
- Create: `backend/src/agents/tools/code/runCode.js`, `backend/src/agents/tools/leetcode/findProblem.js`, `backend/src/agents/tools/practice/readCandidateCode.js`, `backend/src/agents/tools/practice/endSession.js`, `backend/src/agents/tools/index.js`
- Test: `backend/src/tests/agents/tools/{code/runCode,leetcode/findProblem,practice/readCandidateCode,practice/endSession}.test.js`

**Interfaces:**
- `createRunCodeTool({ runCode, languages, onRun? })` → outil `run_code`, schéma `{ language: z.enum(languages), code: z.string().max(50000), stdin: z.string().max(10000).default("") }`. Renvoie une chaîne JSON `{ runId, output, exitCode, timedOut }` (`runId` = `run-<n>`, compteur par instance d'outil) ; `onRun({ runId, language, code, stdin, output, exitCode, timedOut })` appelé après chaque exécution. Erreur de `runCode` → renvoie la chaîne `"The code runner is unavailable; continue without running code."` (pas d'exception).
- `createFindProblemTool({ searchProblems })` → `find_problem`, schéma `{ difficulty: z.enum(["EASY","MEDIUM","HARD"]), tags: z.array(z.string()).max(3).default([]) }`. Appelle `searchProblems({ category: "algorithms", tags, difficulty, offset: <0..50 aléatoire injectable>, limit: 10 })`, renvoie au plus 5 `{ title, difficulty, url: "https://leetcode.com/problems/<slug>/" }` en JSON. Erreur → chaîne « LeetCode search failed; invent a classic problem instead. ». La description dit d'écrire son propre énoncé.
- `createReadCandidateCodeTool()` → `read_candidate_code`, schéma `{}`, renvoie `runtime.context.code` (ou « (the editor is empty) ») préfixé du langage.
- `createEndSessionTool()` → `end_session`, schéma `{ reason: z.enum(["solved","gave_up","out_of_time"]) }`, renvoie « Session ended. Say a short goodbye. ».
- `agents/tools/index.js` réexporte les quatre factories et `END_SESSION_TOOL = "end_session"`.

- [ ] **Step 1: Tests** (outil invoqué par `tool.invoke(args, { context })` ou via `fakeModel` + `createAgent` pour `read_candidate_code`) : `run_code` transmet `{ language, code, stdin }`, numérote `run-1` puis `run-2`, appelle `onRun`, refuse `ruby` (erreur de schéma) ; panne → la chaîne de repli ; `find_problem` ne renvoie que `title`, `difficulty`, `url` (aucun autre champ, jamais de `content`) et 5 éléments max ; `read_candidate_code` renvoie le code du contexte ; `end_session` refuse une raison inconnue.
- [ ] **Step 2: Lancer** `npx vitest run src/tests/agents/tools` — Expected: FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): shared tools run_code, find_problem, read_candidate_code, end_session`.

### Task 5: Middlewares partagés (`agents/middleware/`)

**Files:**
- Create: `backend/src/agents/middleware/limits.js`, `backend/src/agents/middleware/logging.js`, `backend/src/agents/middleware/index.js`
- Test: `backend/src/tests/agents/middleware/{limits,logging}.test.js`

**Interfaces:**
- `turnLimits({ modelCalls, toolCalls })` → `[modelCallLimitMiddleware({ runLimit: modelCalls, exitBehavior: "end" }), toolCallLimitMiddleware({ runLimit: toolCalls, exitBehavior: "continue" })]`.
- `MODEL_LIMIT_PREFIX = "Model call limits exceeded"` et `isLimitMessage(message) → boolean`.
- `createLoggingMiddleware({ agent, log })` (via `createMiddleware`, `wrapModelCall` + `wrapToolCall`) : `log({ agent, event: "model" | "tool", tool?, ms, ok })` — jamais le contenu des messages ni les arguments.
- `withFallback(fallbackModel)` → `fallbackModel ? [modelFallbackMiddleware(fallbackModel)] : []` (chaîne `provider:model`).

- [ ] **Step 1: Tests** : agent `fakeModel` qui demande trois fois un outil avec `turnLimits({ modelCalls: 2, toolCalls: 8 })` → 2 appels modèle et dernier message reconnu par `isLimitMessage` ; le journal reçoit `event: "tool"` avec `tool: "run_code"` et aucune propriété contenant le texte du message ou les arguments (vérifier par `JSON.stringify(log.mock.calls)` qui ne contient pas le texte secret envoyé).
- [ ] **Step 2: Lancer** — Expected: FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): shared turn limits, content-free logging, model fallback`.

### Task 6: Agent intervieweur (`agents/practiceInterviewer/`)

**Files:**
- Create: `backend/src/agents/practiceInterviewer/{index.js,agent.js,prompts.js,README.md}`
- Test: `backend/src/tests/agents/practiceInterviewer/agent.test.js`

**Interfaces:**
- `createPracticeInterviewer({ model, fallbackModel?, runCode, languages, searchProblems, checkpointer, log = () => {} })` → `{ streamTurn, history }`.
- Contexte runtime (zod `contextSchema`) : `{ sessionId, role, interviewType, code, language }` — jamais dans les checkpoints.
- `streamTurn({ sessionId, text, code, language, role, interviewType, signal })` → itérable asynchrone d'événements `{ type: "token", text }` | `{ type: "tool", name }` | `{ type: "done", ended: boolean, limited: boolean }`. `thread_id = "practice:<sessionId>"`, `recursionLimit: 25`, `streamMode: ["messages", "updates"]` ; tokens = morceaux IA à texte non vide **sans** appel d'outil ; `tool` = chaque ToolMessage des mises à jour ; `ended` = un appel `end_session` a eu lieu pendant ce tour ; `limited` = dernier message reconnu par `isLimitMessage`.
- `history(sessionId)` → `[{ role: "candidate" | "interviewer", text }]` : messages humains et IA à texte non vide, sans les messages d'outils ni le message de limite.
- Prompt (`prompts.js`, `buildInterviewerPrompt({ role, interviewType })`) : intervieweur bienveillant ; au premier tour appeler `find_problem`, puis écrire **son propre** énoncé en citant le titre et le lien ; lire le code avec `read_candidate_code` avant tout commentaire sur le code ; indices gradués (question → piste → approche), jamais la solution complète ; `run_code` pour vérifier ; `end_session` quand le candidat a fini, abandonne ou demande à arrêter ; répondre dans la langue du candidat ; réponses courtes.

- [ ] **Step 1: Tests** (`fakeModel`, `MemorySaver`, faux `runCode` / `searchProblems`) :
  - premier tour scénarisé `find_problem` → texte : événements `tool(find_problem)` puis au moins un `token`, puis `done { ended: false, limited: false }` ; `searchProblems` appelé une fois ;
  - le contexte arrive à l'outil : scénario `read_candidate_code` → le ToolMessage contient le `code` passé à `streamTurn` ;
  - `end_session` → `done.ended === true` ;
  - modèle qui boucle sur `run_code` → 6 appels modèle max et `done.limited === true` ;
  - `history` après deux tours → 2 messages candidat et 2 intervieweur, aucun message d'outil ni de limite ;
  - `signal` interrompu pendant un outil lent → l'itération lève `AbortError` et le modèle n'est plus appelé ensuite.
- [ ] **Step 2: Lancer** — Expected: FAIL.
- [ ] **Step 3: Implémenter** `agent.js` (`createAgent({ model, tools, systemPrompt, contextSchema, checkpointer, middleware: [...turnLimits({ modelCalls: 6, toolCalls: 8 }), ...withFallback(fallbackModel), createLoggingMiddleware({ agent: "practiceInterviewer", log })] })`) ; le prompt système dépend du rôle : utiliser `dynamicSystemPromptMiddleware` lisant `runtime.context` (vérifier sa signature dans `node_modules/langchain/dist/agents/middleware/dynamicSystemPrompt.d.ts` avant de l'écrire).
- [ ] **Step 4: Lancer** — Expected: PASS.
- [ ] **Step 5: README** court (rôle, outils, limites, comment tester) et **Commit** `feat(agents): practice interviewer agent (createAgent, tools, limits, streaming)`.

### Task 7: Agent coach (`agents/practiceCoach/`)

**Files:**
- Create: `backend/src/agents/practiceCoach/{index.js,agent.js,report.js,prompts.js}`
- Test: `backend/src/tests/agents/practiceCoach/agent.test.js`

**Interfaces:**
- `report.js` : `PracticeReportSchema = z.object({ summary: z.string(), strengths: z.array(z.string()), improvements: z.array(z.string()), testsRun: z.array(z.object({ runId: z.string(), input: z.string(), expected: z.string(), actual: z.string(), passed: z.boolean() })), complexity: z.object({ time: z.string(), space: z.string(), comment: z.string() }), nextSteps: z.array(z.string()) })` et `reportFormat = toolStrategy(PracticeReportSchema)` (une seule fois).
- `createPracticeCoach({ model, fallbackModel?, runCode, languages, log })` → `{ review({ transcript, code, language }) → PracticeReport }` (`transcript` = sortie de `history`).
- Pas de checkpointer ; outils : `run_code` (avec `onRun` qui mémorise les exécutions de cet appel) et `read_candidate_code` ; contexte `{ code, language }` ; `turnLimits({ modelCalls: 8, toolCalls: 10 })`, `recursionLimit: 40`.
- Après l'agent : `testsRun` filtré sur les `runId` mémorisés, `actual` = sortie réelle ; aucun rapport structuré → lève `CoachFailedError`.

- [ ] **Step 1: Tests** : scénario `run_code` ×2 puis `reportFormat[0].name` avec 3 tests dont un `runId: "run-9"` inventé → le bilan validé ne garde que `run-1` et `run-2`, et `actual` vaut la sortie du faux `runCode` même si le modèle a écrit autre chose ; une réponse structurée invalide puis valide → bilan valide (2 appels) ; modèle qui ne produit jamais de bilan → `CoachFailedError`.
- [ ] **Step 2: Lancer** — Expected: FAIL.
- [ ] **Step 3: Implémenter** (prompt : relire la séance, inventer des cas limites, les exécuter avec `run_code`, ne citer que des tests lancés, ton encourageant, pas de note, langue de la séance).
- [ ] **Step 4: Lancer** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): practice coach agent with structured, run-verified report`.

### Task 8: Service d'entraînement (règles et plafonds)

**Files:**
- Create: `backend/src/services/practice.service.js`
- Test: `backend/src/tests/services/practice.service.test.js`

**Interfaces:**
- `createPracticeService({ practiceSessionRepository, interviewRepository, interviewer, coach, codeService, messageLimiter, now, runInBackground = (fn) => void fn() })` :
  - `start(principal, { language })` → session ; 409 « A practice session is already active » si une séance active a moins de 60 min (une séance active plus vieille est d'abord terminée, avec bilan) ; 409 « Practice limit reached » si `countSince(interviewId, practiceCreatedAt) >= 3`.
  - `get(principal, sessionId)` → `{ id, status, language, code, startedAt, finishedAt, messages: history, report, reportStatus: "none" | "pending" | "ready" | "failed" }` ; séance d'un autre entretien → 404.
  - `streamMessage(principal, sessionId, { text, code, language }, signal)` → itérable d'événements de `streamTurn` ; avant : 404 / 409 « Session finished » / 409 « Session time is over » (et fin de séance) / 429 (`messageLimiter`, clé `practice:<interviewId>`) / 409 « Message limit reached » si `claimMessage(id, { max: 60, … })` est faux. Après un `done.ended`, `finish` est appelé.
  - `finish(principal, sessionId)` → `{ status: "finished" }` ; `repository.finish` ; si vrai, `runInBackground(() => coach.review(...) → saveReport, échec → saveReport({ failed: true }))`.
  - `run(principal, body)` → `codeService.run(principal, body)`.
- Constantes : `MAX_SESSIONS_PER_LINK = 3`, `SESSION_MS = 60 * 60 * 1000`, `MAX_MESSAGES = 60`.

- [ ] **Step 1: Tests** (dépôts et agents simulés, `now` fixé) : chaque refus ci-dessus avec son statut et son message ; séance active vieille de 61 min → `start` réussit et l'ancienne est terminée ; `claimMessage` faux → 409 sans appeler l'agent ; `done.ended` → `finish` puis `coach.review` ; échec du coach → `saveReport({ failed: true })` ; `reportStatus` pour chacun des 4 cas.
- [ ] **Step 2: Lancer** — Expected: FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(practice): practice service with session caps, time limit and background report`.

### Task 9: API `/api/practice` (SSE), câblage

**Files:**
- Create: `backend/src/validators/practice.schemas.js`, `backend/src/controllers/practice.controller.js`, `backend/src/routes/practice.routes.js`
- Modify: `backend/src/app.js`, `backend/src/container.js`, `backend/src/tests/helpers/testApp.js`
- Test: `backend/src/tests/http/practice.test.js`

**Interfaces:**
- Routes : `POST /sessions` `{ language }` → 201 ; `GET /sessions/:sid` → 200 ; `POST /sessions/:sid/messages` `{ text: 1..4000, code: ≤50000, language }` → `text/event-stream` ; `POST /sessions/:sid/finish` → 200 ; `POST /run` (même corps que `/api/code/run`) → 200.
- SSE : `event: token` `{"text"}` · `event: tool` `{"name"}` · `event: done` `{"ended","limited"}` · `event: error` `{"message":"The interviewer is unavailable right now."}`. Les refus avant le flux restent des réponses JSON normales (404/409/429). `req.on("close")` → `abort()`.
- `app.js` : `app.use("/api/practice", authenticatePractice(auth.resolver), routers.practice)` (hors `MOUNTS`, qui utilisent `authenticate`).
- `container.js` : un checkpointer partagé paresseux (`getCheckpointer()`, réutilisé par `getAi()`) ; options de test `practiceInterviewer`, `practiceCoach` (faux agents). Les vrais agents reçoivent `model: config.aiModel`, `fallbackModel: config.aiModelFallback`, `runCode` du `codeRunner`, `languages: EDITOR_LANGUAGES`, `searchProblems` du client LeetCode, `log` → `console.info` (JSON).
- `testApp.js` : `PRINCIPALS.practiceOf(interviewId)`.

- [ ] **Step 1: Tests** : chaque route avec `practiceOf("iv-1")` ; séance d'un autre entretien → 404 ; principal `demo` ou `candidate` sur `/api/practice/*` (via `authAs`) → 401 ; un message renvoie un flux dont le texte contient `event: token`, puis `event: done` ; faux agent qui lève → `event: error` avec le message générique (jamais le texte de l'erreur) ; validation (`text` vide → 400).
- [ ] **Step 2: Lancer** — Expected: FAIL.
- [ ] **Step 3: Implémenter.** Le controller écrit les en-têtes `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, puis `res.flushHeaders()`.
- [ ] **Step 4: Lancer** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(practice): /api/practice routes with SSE streaming, wired in the container`.

### Task 10: Garde-fous d'architecture, docs, essai réel

**Files:**
- Modify: `backend/src/tests/architecture/aiWiring.test.js`, `CLAUDE.md`, `backend/src/agents/questionGenerator/README.md` (lien vers les nouveaux dossiers)

- [ ] **Step 1: Tests** : la règle « seulement par `index.js` » couvre `practiceInterviewer` et `practiceCoach` ; `agents/tools/` et `agents/middleware/` ne sont importés que depuis `agents/` ; chaque fichier de `agents/tools/**` (sauf `index.js`) appelle `tool(` une fois et chaque champ de schéma a `.describe(` (vérif. textuelle simple).
- [ ] **Step 2: Lancer** — Expected: PASS (ou corriger ce qu'ils révèlent).
- [ ] **Step 3: CLAUDE.md** : principal `practice` dans le tableau, `/api/practice`, nouveaux dossiers d'agents, plafonds.
- [ ] **Step 4: Essai réel** (une séance, coût de quelques centimes, avec la clé déjà configurée, sans la lire) : script dans le scratchpad qui crée un lien via le service, démarre une séance, envoie 2 messages, termine, attend le bilan, puis **supprime la séance et efface le hash** créés. Expected: un énoncé écrit par l'agent qui cite un lien leetcode.com, un bilan dont chaque `testsRun` a un `runId` réel.
- [ ] **Step 5: Commit** `test(architecture): guard practice agents, tools and middleware; docs`.

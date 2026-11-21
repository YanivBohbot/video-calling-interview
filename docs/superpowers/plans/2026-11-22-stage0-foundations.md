# Étape 0 — Fondations (Piston auto-hébergé, LeetCode en appel direct) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remettre en marche l'exécution de code via un Piston auto-hébergé appelé par le backend, et remplacer le serveur MCP LeetCode par un appel GraphQL direct, en posant le dossier `integrations/` que l'étape 1 réutilisera.

**Architecture:** `backend/src/integrations/<service>/client.js` contient des clients HTTP sans LangChain (dépendances `fetch` et URL injectées). `container.js` les construit et les passe : au nouveau service REST `code` (`POST /api/code/run`) et au contexte runtime du générateur de questions (`searchProblems`). Les agents n'importent jamais `integrations/`.

**Tech Stack:** Express 5 ESM, zod, vitest + Supertest, Docker Compose, Piston (`ghcr.io/engineer-man/piston`), API GraphQL de leetcode.com, React 19 + TS.

**Spec:** `docs/superpowers/specs/2026-11-22-practice-interviewer-design.md` (section « Étape 0 »).

## Global Constraints

- Couches : routes → controllers → services → repositories ; chaque couche est une factory à dépendances injectées ; erreurs = `AppError` ; `handle("<message>", fn)` dans les controllers, jamais `err.message` dans une réponse.
- Les agents n'importent ni Prisma, ni `process.env`, ni `integrations/` (tout passe par `container.js`).
- Le reste du backend n'importe le générateur que par `agents/questionGenerator/index.js`.
- Tests dans `src/tests/` : `http/` pour l'API, `integrations/<service>/` pour les clients, `agents/…` pour les agents, `architecture/` pour les règles d'import.
- Ne jamais lire les valeurs de `.env` ; ne jamais committer `backend/.env.example` (modifié localement, contient une clé) ; ne jamais lancer `npm run seed` ni `prisma migrate reset`.
- Pas de push, pas de merge sans accord explicite.
- Langages de l'éditeur : `javascript`, `typescript`, `python`, `java`, `cpp`.
- Énoncés LeetCode : on ne récupère que titre, slug, difficulté, tags — jamais le contenu des énoncés.

## Review Focus

- Piston arrêté ou langage non installé → l'utilisateur voit « Code runner unavailable » (502), pas une page blanche ni un 500 ; test en Task 3.
- Code en boucle infinie → Piston le tue ; la réponse dit que l'exécution a dépassé le temps (`timedOut: true`) ; test en Task 2.
- Sortie énorme (`while(true) print`) → sortie tronquée à 20 000 caractères avec un marqueur ; test en Task 2.
- LeetCode renvoie du HTML (Cloudflare, 403) ou une erreur GraphQL → `searchProblems` lève, le researcher continue sans ancrage (comportement existant) ; test en Task 5.
- Erreur de compilation Java/C++ → affichée comme sortie (exit code ≠ 0), pas comme panne ; test en Task 2.

---

### Task 1: Piston dans Docker + installation des langages + config

**Files:**
- Modify: `docker-compose.yml`
- Create: `backend/scripts/install-piston-packages.js`
- Modify: `backend/package.json` (script `piston:install`)
- Modify: `backend/src/config/env.js` (+ `PISTON_URL`)
- Test: `backend/src/config/env.test.js`

**Interfaces:**
- Produces: `config.pistonUrl: string` (défaut `"http://localhost:2000"`).

- [ ] **Step 1: Test de config qui échoue**

```js
it("defaults PISTON_URL to the local Piston container", () => {
  expect(loadConfig(base).pistonUrl).toBe("http://localhost:2000");
});
it("reads PISTON_URL when set", () => {
  expect(loadConfig({ ...base, PISTON_URL: "http://piston:2000" }).pistonUrl).toBe("http://piston:2000");
});
```
(`base` = l'objet d'env valide déjà défini en tête de `env.test.js`.)

- [ ] **Step 2: Lancer** `cd backend && npx vitest run src/config/env.test.js` — Expected: FAIL (`pistonUrl` undefined).

- [ ] **Step 3: Ajouter** `PISTON_URL: blankAsUnset(z.string().url().default("http://localhost:2000"))` à `EnvSchema` et `pistonUrl: e.PISTON_URL` au retour de `loadConfig`.

- [ ] **Step 4: Relancer** — Expected: PASS.

- [ ] **Step 5: Service Docker** — ajouter à `docker-compose.yml` :

```yaml
  piston:
    image: ghcr.io/engineer-man/piston
    privileged: true          # Piston isole chaque exécution avec isolate (cgroups)
    ports:
      - "2000:2000"
    volumes:
      - piston_packages:/piston/packages
    tmpfs:
      - /piston/jobs:exec,uid=1000,gid=1000,mode=711
    restart: unless-stopped
```
et `piston_packages:` sous `volumes:`.

- [ ] **Step 6: Script `backend/scripts/install-piston-packages.js`** (ESM, `node` seul, pas de dépendance) : lit `PISTON_URL` (défaut `http://localhost:2000`), `GET /api/v2/packages`, garde pour chacun des langages Piston `["node", "typescript", "python", "java", "gcc"]` la version la plus récente non installée (tri semver simple sur `language_version`), puis `POST /api/v2/packages { language, version }` une par une, en affichant `installed <language> <version>` ou `already installed`. Script npm : `"piston:install": "node scripts/install-piston-packages.js"`.

- [ ] **Step 7: Vérification manuelle**
Run: `docker compose up -d piston && cd backend && npm run piston:install` puis
`curl -s -X POST http://localhost:2000/api/v2/execute -H "Content-Type: application/json" -d '{"language":"python","version":"*","files":[{"content":"print(1+1)"}]}'`
Expected: JSON contenant `"output":"2\n"`. Si le conteneur refuse de démarrer (privilèges sous Docker Desktop), s'arrêter et le signaler.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml backend/scripts/install-piston-packages.js backend/package.json backend/src/config/env.js backend/src/config/env.test.js
git commit -m "feat(code): self-hosted Piston service, package installer, PISTON_URL config"
```

---

### Task 2: Client Piston (`integrations/piston/client.js`)

**Files:**
- Create: `backend/src/integrations/piston/client.js`
- Test: `backend/src/tests/integrations/piston/client.test.js`

**Interfaces:**
- Produces:
  - `EDITOR_LANGUAGES = ["javascript", "typescript", "python", "java", "cpp"]`
  - `createPistonClient({ baseUrl, fetch = globalThis.fetch, timeoutMs = 15000 })` → `{ runCode({ language, code, stdin = "" }) → Promise<{ output, stdout, stderr, exitCode, timedOut }> }`
  - `class CodeRunnerUnavailableError extends Error` (réseau, statut ≠ 2xx, JSON invalide, délai `timeoutMs` dépassé via `AbortSignal.timeout`).
- Correspondance langage éditeur → Piston : `javascript→javascript`, `typescript→typescript`, `python→python`, `java→java`, `cpp→c++` ; version toujours `"*"`.

- [ ] **Step 1: Tests qui échouent** (un faux `fetch` renvoyant des réponses Piston enregistrées) :

```js
it("posts the Piston language name and returns the run result", async () => {
  const fetch = fakeFetch(200, { run: { stdout: "2\n", stderr: "", output: "2\n", code: 0, signal: null } });
  const piston = createPistonClient({ baseUrl: "http://p:2000", fetch });
  expect(await piston.runCode({ language: "cpp", code: "int main(){}" }))
    .toEqual({ output: "2\n", stdout: "2\n", stderr: "", exitCode: 0, timedOut: false });
  expect(fetch).toHaveBeenCalledWith("http://p:2000/api/v2/execute", expect.objectContaining({ method: "POST" }));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ language: "c++", version: "*", files: [{ content: "int main(){}" }], stdin: "" });
});
it("reports a compile error as output, not as a failure", async () => {
  const fetch = fakeFetch(200, { compile: { stdout: "", stderr: "error: x", output: "error: x", code: 1, signal: null }, run: { stdout: "", stderr: "", output: "", code: null, signal: null } });
  expect(await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "java", code: "x" }))
    .toMatchObject({ output: "error: x", stderr: "error: x", exitCode: 1, timedOut: false });
});
it("flags a run killed by Piston's time limit", async () => {
  const fetch = fakeFetch(200, { run: { stdout: "", stderr: "", output: "", code: null, signal: "SIGKILL" } });
  expect(await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "python", code: "while True: pass" }))
    .toMatchObject({ timedOut: true });
});
it("truncates output beyond 20000 characters", async () => {
  const big = "x".repeat(25000);
  const fetch = fakeFetch(200, { run: { stdout: big, stderr: "", output: big, code: 0, signal: null } });
  const result = await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "python", code: "" });
  expect(result.output.length).toBeLessThan(20100);
  expect(result.output.endsWith("[output truncated]")).toBe(true);
});
it("throws CodeRunnerUnavailableError when Piston is down or answers non-2xx", async () => {
  const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  await expect(createPistonClient({ baseUrl: "http://p", fetch: down }).runCode({ language: "python", code: "" })).rejects.toBeInstanceOf(CodeRunnerUnavailableError);
  await expect(createPistonClient({ baseUrl: "http://p", fetch: fakeFetch(400, { message: "runtime unknown" }) }).runCode({ language: "python", code: "" })).rejects.toBeInstanceOf(CodeRunnerUnavailableError);
});
it("rejects a language the editor does not offer", async () => {
  await expect(createPistonClient({ baseUrl: "http://p", fetch: vi.fn() }).runCode({ language: "ruby", code: "" })).rejects.toThrow(/unsupported language/i);
});
```
(`fakeFetch(status, body)` = helper local au fichier de test : `vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body })`.)

- [ ] **Step 2: Lancer** `cd backend && npx vitest run src/tests/integrations/piston` — Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter** `client.js` selon l'interface. Si `compile` existe et `compile.code !== 0`, le résultat vient de `compile` ; sinon de `run`. `timedOut = run.signal === "SIGKILL"`. Troncature à 20 000 caractères appliquée à `output`, `stdout`, `stderr`, suffixe `"\n[output truncated]"`.

- [ ] **Step 4: Relancer** — Expected: PASS (6 tests).

- [ ] **Step 5: Commit** `git add backend/src/integrations/piston backend/src/tests/integrations/piston && git commit -m "feat(code): Piston HTTP client"`

---

### Task 3: API `POST /api/code/run`

**Files:**
- Create: `backend/src/validators/code.schemas.js`, `backend/src/services/code.service.js`, `backend/src/controllers/code.controller.js`, `backend/src/routes/code.routes.js`
- Modify: `backend/src/app.js` (MOUNTS + `["code", "/api/code"]`), `backend/src/container.js`
- Test: `backend/src/tests/http/code.test.js`

**Interfaces:**
- Consumes: `createPistonClient`, `EDITOR_LANGUAGES`, `CodeRunnerUnavailableError` (Task 2) ; `config.pistonUrl` (Task 1) ; `createRateLimiter`.
- Produces:
  - `runCodeBody = z.object({ language: z.enum(EDITOR_LANGUAGES), code: z.string().max(50000), stdin: z.string().max(10000).optional() })`
  - `createCodeService({ codeRunner, rateLimiter })` → `{ run(principal, { language, code, stdin }) → { output, stdout, stderr, exitCode, timedOut } }`
  - `createContainer({ …, codeRunner? })` : fake injectable ; défaut `createPistonClient({ baseUrl: config.pistonUrl })`.
- Règles : tous les types de principal (`interviewer`, `demo`, `candidate`) ; limite **30 exécutions / minute** par clé (`userId` pour interviewer et demo, `candidate:<interviewId>` pour candidate) → `RateLimitError` ; `CodeRunnerUnavailableError` → `UpstreamError("Code runner unavailable")` (502).

- [ ] **Step 1: Tests HTTP qui échouent** (`buildTestApp({ principal, codeRunner })`) :

```js
it("runs code for an interviewer", async () => {
  const codeRunner = { runCode: vi.fn().mockResolvedValue({ output: "2\n", stdout: "2\n", stderr: "", exitCode: 0, timedOut: false }) };
  const res = await request(buildTestApp({ principal: PRINCIPALS.ada, codeRunner }))
    .post("/api/code/run").send({ language: "python", code: "print(1+1)" });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ output: "2\n", stdout: "2\n", stderr: "", exitCode: 0, timedOut: false });
  expect(codeRunner.runCode).toHaveBeenCalledWith({ language: "python", code: "print(1+1)", stdin: undefined });
});
it("lets an invited candidate run code", async () => { /* principal: PRINCIPALS.candidateOf("iv-1") → 200 (le stub prisma doit connaître "iv-1" si le résolveur de test le vérifie) */ });
it("rejects an unknown language with 400", async () => { /* language: "ruby" → 400, runCode not called */ });
it("rejects code over 50000 characters with 400", async () => { /* code: "x".repeat(50001) → 400 */ });
it("answers 502 'Code runner unavailable' when Piston is down", async () => {
  const codeRunner = { runCode: vi.fn().mockRejectedValue(new CodeRunnerUnavailableError("down")) };
  const res = await request(buildTestApp({ principal: PRINCIPALS.ada, codeRunner })).post("/api/code/run").send({ language: "python", code: "" });
  expect(res.status).toBe(502);
  expect(res.body.message).toBe("Code runner unavailable");
});
it("limits each caller to 30 runs per minute", async () => { /* 30 × 200 puis 31e → 429 avec retryAfter */ });
it("needs a credential", async () => { /* sans en-tête d'auth (helper existant des tests auth) → 401 */ });
```
(Principals : `PRINCIPALS.ada`, `PRINCIPALS.demo`, `PRINCIPALS.candidateOf(id)` de `tests/helpers/testApp.js`.)

- [ ] **Step 2: Lancer** `cd backend && npx vitest run src/tests/http/code.test.js` — Expected: FAIL (404 sur la route).

- [ ] **Step 3: Implémenter** schéma, service, controller (`handle("Failed to run code", …)`), routeur (`validate({ body: runCodeBody })`), montage dans `MOUNTS`, câblage `container.js` (`codeRunner` injectable, limiteur `createRateLimiter({ max: 30, windowMs: 60_000 })`).

- [ ] **Step 4: Relancer le fichier puis toute la suite** `cd backend && npm test` — Expected: tout PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(code): POST /api/code/run through the backend (all principals, 30/min, 502 when down)"`

---

### Task 4: Le bouton Run passe par le backend

**Files:**
- Modify: `frontend/src/components/CollaborativeEditor.tsx` (fonction `runCode`, props)
- Modify: `frontend/src/pages/InterviewRoom.tsx`, `frontend/src/pages/CandidateRoom.tsx` (passer `apiFetch`)

**Interfaces:**
- Consumes: `POST /api/code/run` (Task 3) ; `useApi()` / `useApi({ invite })` (`apiFetch`) déjà présents dans les deux pages.
- Produces: prop `apiFetch: (path: string, init?: RequestInit) => Promise<Response>` sur `CollaborativeEditor` (type `ApiFetch` à déclarer et exporter dans `src/lib/api.ts`, qui n'en exporte pas aujourd'hui).

- [ ] **Step 1: Modifier `runCode`** : `apiFetch('/api/code/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, code }) })`. Affichage : `timedOut` → `"Execution timed out."` suivi de la sortie ; 429 → `"Too many runs — try again in <retryAfter>s"` ; 502 → `"The code runner is unavailable right now."` ; sinon `output || "No output."`. Supprimer la `languageMap` (le backend fait la correspondance). L'émission `code-execution` reste identique.

- [ ] **Step 2: Vérifier** `cd frontend && npm run build && npm run lint` — Expected: build OK, aucune nouvelle erreur de lint.

- [ ] **Step 3: Vérification manuelle** (avec l'accord de l'utilisateur pour démarrer les serveurs) : dans une salle, Run sur `console.log(1+1)` affiche `2`. Si non faite, le dire dans le rapport.

- [ ] **Step 4: Commit** `git commit -m "fix(editor): Run executes through the backend (public Piston API is whitelist-only)"`

---

### Task 5: Client LeetCode GraphQL (`integrations/leetcode/client.js`)

**Files:**
- Create: `backend/src/integrations/leetcode/client.js`
- Test: `backend/src/tests/integrations/leetcode/client.test.js`

**Interfaces:**
- Produces: `createLeetCodeClient({ fetch = globalThis.fetch, endpoint = "https://leetcode.com/graphql", timeoutMs = 10000 })` → `{ searchProblems({ category, tags = [], difficulty, offset = 0, limit = 20 }) → Promise<Array<{ slug, title, difficulty }>> }` — même forme de sortie que l'actuel `createSearchProblems`, donc le researcher ne change pas.
- Requête (vérifiée en direct le 2026-11-22) :

```graphql
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data { title titleSlug difficulty paidOnly: isPaidOnly }
  }
}
```
Variables : `categorySlug = category`, `skip = offset`, `limit`, `filters = { difficulty, tags }` (`tags` omis s'il est vide). En-têtes : `Content-Type: application/json`, `Referer: https://leetcode.com/problemset/`. Réponse : `data.problemsetQuestionList.questions`.

- [ ] **Step 1: Tests qui échouent** :

```js
it("maps the filters to GraphQL variables", async () => {
  const fetch = fakeFetch(200, { data: { problemsetQuestionList: { total: 1, questions: [] } } });
  await createLeetCodeClient({ fetch }).searchProblems({ category: "algorithms", tags: ["hash-table"], difficulty: "MEDIUM", offset: 5, limit: 9 });
  expect(JSON.parse(fetch.mock.calls[0][1].body).variables)
    .toEqual({ categorySlug: "algorithms", skip: 5, limit: 9, filters: { difficulty: "MEDIUM", tags: ["hash-table"] } });
});
it("omits empty tags", async () => { /* tags: [] → filters: { difficulty: "EASY" } */ });
it("returns slug, title and difficulty and drops paid-only problems", async () => {
  const fetch = fakeFetch(200, { data: { problemsetQuestionList: { total: 2, questions: [
    { title: "Two Sum", titleSlug: "two-sum", difficulty: "Easy", paidOnly: false },
    { title: "Locked", titleSlug: "locked", difficulty: "Hard", paidOnly: true },
  ] } } });
  expect(await createLeetCodeClient({ fetch }).searchProblems({ category: "algorithms", difficulty: "EASY" }))
    .toEqual([{ slug: "two-sum", title: "Two Sum", difficulty: "Easy" }]);
});
it("throws on a non-2xx or non-JSON answer (e.g. a Cloudflare page)", async () => {
  const html = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => { throw new SyntaxError("Unexpected token <"); } });
  await expect(createLeetCodeClient({ fetch: html }).searchProblems({ category: "algorithms", difficulty: "EASY" })).rejects.toThrow(/leetcode/i);
});
it("throws on GraphQL errors", async () => {
  const fetch = fakeFetch(200, { errors: [{ message: "bad filter" }] });
  await expect(createLeetCodeClient({ fetch }).searchProblems({ category: "algorithms", difficulty: "EASY" })).rejects.toThrow(/leetcode/i);
});
```

- [ ] **Step 2: Lancer** `cd backend && npx vitest run src/tests/integrations/leetcode` — Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter** selon l'interface (`AbortSignal.timeout(timeoutMs)`, messages d'erreur commençant par `"LeetCode search failed"`, sans le corps de la réponse).

- [ ] **Step 4: Relancer** — Expected: PASS (5 tests).

- [ ] **Step 5: Commit** `git commit -m "feat(leetcode): direct GraphQL search client"`

---

### Task 6: Le générateur utilise le client direct ; suppression du MCP

**Files:**
- Modify: `backend/src/container.js`, `backend/src/server.js`, `backend/src/agents/questionGenerator/index.js`, `backend/src/agents/questionGenerator/graph/state.js` (commentaire de `searchProblems`), `backend/src/agents/questionGenerator/graph/nodes/researcher.js` (commentaire)
- Modify: `backend/src/agents/questionGenerator/tools/leetcode/sources.js` (retirer `parseSearchProblems`, garder `leetcodeUrl` et `attachSources`)
- Delete: `backend/src/agents/questionGenerator/mcp/`, `backend/src/agents/questionGenerator/tools/leetcode/search.js`, leurs tests dans `src/tests/agents/questionGenerator/`
- Modify: `backend/src/tests/agents/questionGenerator/tools/leetcode/sources.test.js` (retirer les tests de `parseSearchProblems`)
- Modify: `backend/src/tests/architecture/aiWiring.test.js`
- Modify: `backend/package.json` (retirer `@langchain/mcp-adapters`), `backend/package-lock.json` via `npm uninstall`
- Modify: `backend/src/agents/questionGenerator/README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `createLeetCodeClient` (Task 5).
- Produces:
  - `createContainer({ …, leetcode? })` : fake injectable `{ searchProblems }` ; défaut `createLeetCodeClient()`. L'option `ai.createMcpClient` disparaît.
  - Contexte du graphe : `searchProblems: leetcode.searchProblems`.
  - `container.ai` = `{ setup }` seulement (`warmUp` et `close` supprimés, plus de processus enfant) ; `server.js` ne les appelle plus.
  - `index.js` n'exporte plus `createLeetCodeTools`, `LEETCODE_MCP_PACKAGE`, `createSearchProblems`.

- [ ] **Step 1: Tests d'architecture qui échouent** — dans `aiWiring.test.js` :

```js
it("builds nothing AI-related until a generation is requested", () => {
  const searchProblems = vi.fn();
  const container = createContainer({ config: TEST_CONFIG, prisma: {}, leetcode: { searchProblems } });
  expect(container.ai.setup).toBeTypeOf("function");
  expect(container.ai.warmUp).toBeUndefined();
  expect(searchProblems).not.toHaveBeenCalled();
});
it("agents never import integrations/ (clients are injected by container.js)", async () => {
  // même parcours que le test « never import Prisma » ; motif : /integrations\//
});
```

- [ ] **Step 2: Lancer** `cd backend && npx vitest run src/tests/architecture` — Expected: FAIL (`warmUp` existe encore).

- [ ] **Step 3: Implémenter** le câblage et les suppressions listées ; `npm uninstall @langchain/mcp-adapters` dans `backend/`. Vérifier qu'aucun fichier ne référence encore `mcp-adapters`, `createLeetCodeTools` ou `parseSearchProblems` : `grep -rn "mcp-adapters\|createLeetCodeTools\|parseSearchProblems\|LEETCODE_MCP" backend/src` → aucune sortie.

- [ ] **Step 4: Toute la suite** `cd backend && npm test` — Expected: tout PASS.

- [ ] **Step 5: Docs** — README de l'agent : retirer la section `mcp/`, `tools/leetcode/` ne contient plus que `sources.js`, la ligne « MCP » du tableau « How it follows the docs » est remplacée par « LeetCode via `integrations/leetcode/client.js` (GraphQL direct), injecté par `container.js` ». `CLAUDE.md` : arbre de l'agent mis à jour, ajout de `integrations/` dans le plan du backend, `POST /api/code/run` et Piston auto-hébergé (`docker compose up -d piston`, `npm run piston:install`), retrait de la phrase « Code execution … calls the public Piston API directly from the frontend », port Postgres corrigé en **6300** (c'est la valeur réelle de `docker-compose.yml`).

- [ ] **Step 6: Vérification en direct** (avec l'accord de l'utilisateur pour démarrer le backend) : une génération depuis la salle renvoie des questions avec badges LeetCode ; puis rejeter le brouillon (rien n'est écrit). Si non faite, le dire.

- [ ] **Step 7: Commit** `git commit -m "refactor(ai): LeetCode through the direct client; drop the MCP server and mcp-adapters"`

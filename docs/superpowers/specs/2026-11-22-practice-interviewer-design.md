# Entraînement avec un intervieweur IA — conception

Statut : brouillon à valider · 2026-11-22

## Intention

Un intervieweur envoie au candidat un **lien d'entraînement** avant le vrai entretien. Le
candidat l'ouvre, passe une séance seul face à un **intervieweur IA** (plus tard un avatar
HeyGen) qui lui pose un problème de code, le relance et lui donne des indices pendant qu'il
code dans l'éditeur, puis il reçoit un **bilan** pour progresser.

Pourquoi : rendre l'agent IA vraiment utile dans TalentIQ, sur une tâche non déterministe
(chaque séance part dans une direction différente), avec un agent autonome construit selon la
doc LangChain (`createAgent`, outils, middleware), facile à tester et à étendre.

## Objectifs

- Un lien d'entraînement par entretien, créé par l'intervieweur, sur le modèle du lien
  d'invitation actuel (seul le hash du secret est stocké).
- Un **agent intervieweur** autonome : il choisit le problème, discute avec le candidat, lit
  et exécute son code, relance, donne des indices gradués, décide quand terminer.
- Un **agent coach** qui produit le bilan : il relit la séance, exécute le code final sur des
  cas qu'il invente, et rend un bilan structuré.
- Outils, API et MCP intégrés « de la bonne manière » : chaque intégration à sa place,
  dépendances injectées, aucun accès direct à Prisma ou à `process.env` dans les agents.

## Non-objectifs

- Comptes candidats / entraînement en libre accès (option A, plus tard).
- Évaluer le candidat pour le recrutement : le bilan est pour **lui**, pas une note.
- Multi-agents : deux agents indépendants qui partagent des outils. Le coach pourra devenir un
  sous-agent plus tard sans réécriture.

## Anti-objectifs (échec même si « ça marche »)

- L'agent recopie des énoncés LeetCode : ils sont protégés. Il écrit ses propres énoncés,
  inspirés d'un problème cité par son titre et son lien (comme le générateur actuel).
- Une séance qui coûte sans limite (boucle d'agent sans plafond, messages illimités).
- La clé OpenAI ou HeyGen exposée au navigateur.
- Un agent qu'on ne peut tester qu'avec une vraie clé et un vrai micro.

## Contraintes

- Stack existante : Express 5 ESM en couches (routes → controllers → services → repositories),
  factories avec dépendances injectées, `container.js` comme racine de composition.
- LangChain 1.x / LangGraph 1.x déjà installés ; `PostgresSaver` (schéma `langgraph`) existe.
- Base avec dérive : **jamais** `prisma migrate reset` ; la migration est écrite (`migrate diff`)
  et appliquée avec `migrate deploy`, comme `20261119230000_interview_invite_token`.
- **Piston public n'est plus accessible** (liste blanche depuis le 15/02/2026) : le bouton Run
  actuel est cassé. Il faut une instance Piston auto-hébergée (Docker).
- La machine manque parfois de mémoire : chaque nouveau service Docker doit rester léger
  (Piston avec seulement les langages utilisés).

## Approches envisagées

| | Approche | Verdict |
|---|---|---|
| A | LiveAvatar **LITE** (visage + voix) piloté par **notre** agent LangChain | **choisie** |
| B | LiveAvatar **FULL** (STT + LLM + voix gérés par HeyGen) | écartée : le cerveau n'est plus notre agent, il ne voit ni n'exécute le code |
| C | Voix seule, sans visage | gardée comme étape 2 de A |

A est construite par étapes ; chaque étape est utilisable seule.

## Étapes

**Étape 0 — fondations partagées**
1. Piston auto-hébergé dans `docker-compose.yml` ; le backend expose `POST /api/code/run`
   (authentifié, limité) et le bouton Run passe par là → répare le Run actuel.
2. Client LeetCode direct (`fetch` vers l'API GraphQL de leetcode.com) qui remplace le
   serveur MCP dans le générateur de questions ; le graphe ne change pas (même signature
   `searchProblems`). `mcp/leetcode/` et `@langchain/mcp-adapters` disparaissent.

**Étape 1 — entraînement en chat texte** (cœur de ce document)
**Étape 2 — voix** : transcription du micro et synthèse vocale, branchées sur le même agent.
**Étape 3 — avatar** : LiveAvatar LITE derrière une interface « présentateur ».

## Conception — étape 1

### Parcours

1. L'intervieweur clique « Lien d'entraînement » sur l'entretien →
   `POST /api/interviews/:id/practice` → `…/practice/<id>#practice=<secret>`.
2. Le candidat ouvre le lien : page `/practice/:id` avec l'éditeur Monaco (sans Socket.io,
   il est seul), un panneau de chat, un avertissement « vous parlez à une IA ; votre code et
   vos messages sont envoyés à OpenAI ».
3. « Commencer » crée une séance ; l'agent ouvre la conversation et présente le problème.
4. Chaque message du candidat part avec son code courant ; la réponse arrive en streaming.
5. L'agent (ou le candidat) termine la séance → le coach produit le bilan → affiché au candidat.

### Authentification

- Nouveau type de principal `practice` : `{ kind: "practice", interviewId }`, résolu depuis
  l'en-tête `x-practice-token` (même mécanisme que `x-invite-token`).
- Il n'a accès qu'aux routes `/api/practice/*` de son entretien. Ni questions, ni notes de
  l'intervieweur, ni salle réelle.
- Régénérer le lien, supprimer ou terminer l'entretien invalide le lien.

### Données (une migration)

- `Interview.practiceTokenHash String? @unique`, `practiceCreatedAt DateTime?`
- `PracticeSession { id, interviewId → Interview, status ("active" | "finished"),
  language, code String?, report Json?, messageCount Int, startedAt, finishedAt? }`
- Les messages de la conversation vivent dans le checkpointer (`thread_id = practice:<id>`),
  pas dans une table.

### API (`/api/practice`)

| Route | Fait |
|---|---|
| `POST /sessions` | démarre une séance (refus si une séance est active ou si le plafond est atteint) |
| `GET /sessions/:sid` | état, historique des messages, bilan s'il existe |
| `POST /sessions/:sid/messages` | `{ text, code, language }` → réponse en **SSE** (tokens + événements d'outils) |
| `POST /sessions/:sid/finish` | termine et lance le bilan |

Couches habituelles : `practice.routes.js` → `practice.controller.js` → `practice.service.js`
→ `practiceSession.repository.js` ; schémas zod dans `validators/practice.schemas.js`.

### Organisation des agents

```
backend/src/
  integrations/                 clients d'API externes, sans LangChain, réutilisables par l'API REST
    piston/client.js            runCode({ language, code, stdin }) → { stdout, stderr, exitCode }
    leetcode/client.js          searchProblems(filters), getProblem(slug) — GraphQL direct
  agents/
    tools/                      outils LangChain partagés, un fichier par outil, factories
      code/runCode.js           createRunCodeTool({ codeRunner })
      leetcode/findProblem.js   createFindProblemTool({ leetcode })
      practice/readCandidateCode.js
      practice/endSession.js
    middleware/                 middlewares partagés (limites, logs sans données perso)
    practiceInterviewer/        index.js · agent.js (createAgent) · prompts.js · README.md
    practiceCoach/              index.js · agent.js (createAgent + responseFormat) · report.js (schéma zod) · prompts.js
    questionGenerator/          inchangé (workflow), utilise integrations/leetcode
  tests/agents/…                même arborescence que agents/
```

Règles (étendues dans `tests/architecture/`) :
- Les agents n'importent ni Prisma ni `process.env` ; `container.js` construit les clients et
  les passe aux factories.
- Le reste du backend n'importe un agent que par son `index.js`.
- Un outil = un fichier, nom en snake_case côté modèle, schéma zod avec `.describe()` sur
  chaque champ, description qui dit **quand** l'utiliser.

### Agent intervieweur

- `createAgent({ model, tools, systemPrompt, middleware, checkpointer })`.
- Outils : `find_problem` (LeetCode : filtres → problèmes réels), `read_candidate_code`
  (code courant de la séance), `run_code` (Piston), `end_session` (termine la séance quand le
  candidat a fini ou abandonne).
- Contexte par appel (runtime context) : `sessionId`, `interviewId`, rôle et niveau du poste ;
  jamais stocké dans les checkpoints.
- Prompt : se comporter comme un intervieweur bienveillant ; indices gradués (question → piste
  → approche), ne jamais donner la solution complète ; écrire son propre énoncé.
- Middlewares : limite d'appels au modèle et aux outils par tour, modèle de secours
  (`AI_MODEL_FALLBACK`), journalisation sans le contenu des messages. Noms exacts vérifiés
  dans la doc au moment du plan.

### Agent coach (bilan)

- `createAgent` avec `responseFormat` = schéma zod du bilan :
  `{ summary, strengths[], improvements[], testsRun[{ input, expected, actual, passed }],
  complexity: { time, space, comment }, nextSteps[] }`.
- Outils : `read_candidate_code`, `run_code`, plus l'historique de la conversation en entrée.
- Il invente des cas limites, les exécute, et le bilan ne cite que des tests réellement lancés.

### Limites (coûts)

- Un lien : 3 séances max, valable 7 jours. Une séance : 60 min, 60 messages max.
- Limite de débit par lien (même `rateLimiter.js` que la génération IA).
- `recursionLimit` sur chaque appel d'agent.

### Tests

- `integrations/` : `fetch` simulé (réponses Piston / LeetCode enregistrées).
- Outils : chaque factory avec un faux client.
- Agents : faux modèle de chat qui rejoue un scénario d'appels d'outils écrit à l'avance
  (aucune clé) ; on vérifie les outils appelés, l'arrêt sur les limites, le bilan validé par zod.
- HTTP : `buildTestApp({ principal: practice })` pour chaque route, y compris accès refusés
  (autre entretien → 404, mauvais type de principal → 403) et plafonds.
- Garde-fous d'architecture étendus aux nouveaux dossiers.

## Étapes 2 et 3 (esquisse, conçues en détail plus tard)

- **Voix** : le navigateur enregistre le micro, le backend transcrit (modèle de transcription
  OpenAI) et renvoie le texte à l'agent ; la réponse est lue par une synthèse vocale.
- **Avatar** : interface `presenter.speak(text)` côté frontend ; implémentations « texte
  seul », « voix » puis « LiveAvatar LITE ». Le jeton de séance LiveAvatar est créé par le
  backend (clé jamais dans le navigateur). L'agent ne sait pas qui l'affiche.

## Mes choix (à corriger si besoin)

- SSE pour le streaming plutôt que Socket.io : une séance n'a qu'un participant.
- Piston auto-hébergé plutôt que Judge0 (plus léger, déjà le format utilisé par le frontend).
- `integrations/` hors de `agents/` : le bouton Run (REST) utilise le même client Piston.
- Plafonds (3 séances, 7 jours, 60 min, 60 messages) : valeurs de départ.
- L'agent répond dans la langue du candidat.

## Laissé au constructeur

Noms de fichiers internes non listés, textes de l'interface, mise en page de la page
d'entraînement (dans le style existant), formulation exacte des prompts.

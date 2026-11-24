# src/ai — the agentic part of the backend

Everything that talks to a language model lives here, sorted by **kind of building block**
(the vocabulary of the LangChain / LangGraph docs):

| Kind | What it is | Here |
|---|---|---|
| **Agent** | `createAgent` from `langchain`: a ReAct loop where the **model** decides the next step (answer, or call a tool) | `agents/` |
| **Workflow** | a LangGraph `StateGraph` with **fixed** steps; the code decides the order, each LLM step is one typed call | `workflows/` |
| **Tool** | a LangChain `tool()` an agent may call; one factory per file, clients injected | `tools/` |
| **Prompt** | the system prompts and input builders, one file per agent / workflow | `prompts/` |
| **Middleware** | hooks around the agent loop: LangChain's built-in limit / fallback middlewares, and our own `createMiddleware` ones (budget, logging, a required tool) | `middleware/` |

```
ai/
├── agents/
│   ├── interviewer/        talks with the candidate in the room       → see its README.md
│   └── coach/              writes the end-of-session report (structured response)
├── workflows/
│   └── questionGenerator/  drafts interview questions, human approval → see its README.md
├── tools/                  run_code · find_problem · read_candidate_code · end_session
├── prompts/                interviewer.js · coach.js · questionGenerator.js
├── middleware/             limits · budget · fallback · logging · requireToolBeforeResponse
└── checkpointer.js         PostgresSaver (own "langgraph" schema), shared by the interviewer and the workflow
```

## Who uses what

| | Tools | Prompts | Middleware | Checkpointer |
|---|---|---|---|---|
| `agents/interviewer` | find_problem, read_candidate_code, run_code, end_session | `prompts/interviewer.js` (dynamic, per call) | turnLimits, withFallback, logging | yes, thread `practice:<sessionId>` |
| `agents/coach` | run_code, read_candidate_code | `prompts/coach.js` | createCallBudget, requireToolBeforeResponse(run_code), withFallback, logging | no (one invoke per report) |
| `workflows/questionGenerator` | — (the code runs the LeetCode search) | `prompts/questionGenerator.js` | — | yes, one thread per job |

## Rules (enforced by `src/tests/architecture/aiWiring.test.js`)

- The rest of the backend enters through `agents/<x>/index.js`, `workflows/<x>/index.js` or
  `checkpointer.js` — nothing else.
- `tools/`, `prompts/` and `middleware/` never import an agent or a workflow.
- Nothing here imports Prisma, `src/integrations/` or reads `process.env`: `container.js`
  builds the models and clients (Piston, LeetCode) and passes them in.

## Tests

In `src/tests/ai/`, with the same tree (`agents/coach/agent.js` →
`tests/ai/agents/coach/agent.test.js`). They use LangChain's `fakeModel()` and `MemorySaver`:
no API key needed.

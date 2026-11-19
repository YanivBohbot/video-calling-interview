import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { QuestionGenState } from "./state.js";
import {
  makePlannerNode,
  makeResearcherNode,
  makeDrafterNode,
  validatorNode,
  fallbackNode,
  humanApprovalNode,
  makeFinalizeNode,
} from "./nodes.js";

// The pipeline, and only the pipeline:
//
//   START → planner → researcher → drafter → validator ─┬→ humanApproval ─┬→ finalize → END
//                                    ↑         │         │   (interrupt)    └→ END (rejected)
//                                    │         ├→ drafter (retry with the errors)
//                                    └ fallback ←┘ (retries spent: switch to the fallback model)
//
// Every collaborator is injected (see container.js):
//   chooseSearch / draft  — the LLM calls (models.js)
//   searchProblems        — LeetCode search (leetcodeSearch.js)
//   saveQuestions         — interviewRepository.saveQuestions
//   checkpointer          — PostgresSaver in production (checkpointer.js), MemorySaver in tests
//
// The researcher swallows its own errors (grounding is optional), so only the drafter
// carries a retryPolicy for transient LLM failures.
export const buildGraph = ({ checkpointer = new MemorySaver(), chooseSearch, searchProblems, draft, saveQuestions }) =>
  new StateGraph(QuestionGenState)
    .addNode("planner", makePlannerNode())
    .addNode("researcher", makeResearcherNode({ chooseSearch, searchProblems }))
    .addNode("drafter", makeDrafterNode({ draft }), { retryPolicy: { maxAttempts: 3 } })
    .addNode("validator", validatorNode, { ends: ["humanApproval", "drafter", "fallback"] })
    .addNode("fallback", fallbackNode)
    .addNode("humanApproval", humanApprovalNode, { ends: ["finalize", END] })
    .addNode("finalize", makeFinalizeNode({ saveQuestions }))
    .addEdge(START, "planner")
    .addEdge("planner", "researcher")
    .addEdge("researcher", "drafter")
    .addEdge("drafter", "validator")
    .addEdge("fallback", "drafter")
    .addEdge("finalize", END)
    .compile({ checkpointer });

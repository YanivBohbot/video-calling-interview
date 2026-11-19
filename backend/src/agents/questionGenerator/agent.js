import { StateGraph, START, END } from "@langchain/langgraph";
import { QuestionGenState, QuestionGenContext } from "./utils/state.js";
import {
  plannerNode,
  researcherNode,
  drafterNode,
  validatorNode,
  fallbackNode,
  humanApprovalNode,
  finalizeNode,
} from "./utils/nodes.js";

// Graph construction (the doc's `agent.ts`). The workflow:
//
//   START → planner → researcher → drafter → validator ─┬→ humanApproval ─┬→ finalize → END
//                                    ↑         │         │   (interrupt)    └→ END (rejected)
//                                    │         ├→ drafter (retry with the errors)
//                                    └ fallback ←┘ (retries spent: switch to the fallback model)
//
// Exported uncompiled: the caller compiles it with its checkpointer (PostgresSaver in
// container.js, MemorySaver in tests) and passes the dependencies as runtime context.
// The researcher swallows its own errors (grounding is optional), so only the drafter
// carries a retryPolicy for transient LLM failures.
export const workflow = new StateGraph(QuestionGenState, QuestionGenContext)
  .addNode("planner", plannerNode)
  .addNode("researcher", researcherNode)
  .addNode("drafter", drafterNode, { retryPolicy: { maxAttempts: 3 } })
  .addNode("validator", validatorNode, { ends: ["humanApproval", "drafter", "fallback"] })
  .addNode("fallback", fallbackNode)
  .addNode("humanApproval", humanApprovalNode, { ends: ["finalize", END] })
  .addNode("finalize", finalizeNode)
  .addEdge(START, "planner")
  .addEdge("planner", "researcher")
  .addEdge("researcher", "drafter")
  .addEdge("drafter", "validator")
  .addEdge("fallback", "drafter")
  .addEdge("finalize", END);

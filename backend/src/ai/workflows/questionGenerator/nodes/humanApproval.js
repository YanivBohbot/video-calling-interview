import { Command, END, interrupt } from "@langchain/langgraph";

// User-input step: pause the run with the draft (interrupt) until the interviewer decides.
// On resume LangGraph re-runs this node from the top, so nothing with side
// effects may sit before interrupt().
export const humanApprovalNode = async (state) => {
  const decision = interrupt({ draftQuestions: state.draftQuestions, plan: state.plan });
  return new Command({
    update: { approval: decision },
    goto: decision.approved ? "finalize" : END,
  });
};

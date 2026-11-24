// Action step: persist the approved questions (through the interview repository).
export const finalizeNode = async (state, runtime) => {
  await runtime.context.saveQuestions(state.interviewId, state.approval?.questions ?? state.draftQuestions);
  return {};
};

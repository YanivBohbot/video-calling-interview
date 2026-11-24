// Data step: switch the drafter to AI_MODEL_FALLBACK for one last pass.
export const fallbackNode = async (state) => ({
  useFallbackModel: true,
  retryCount: state.retryCount + 1,
});

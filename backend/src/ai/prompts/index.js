// The agents' and workflows' prompts, one file per agent / workflow.
export { buildInterviewerPrompt, buildQuestionSwitchNote, buildAvatarInterviewerPrompt } from "./interviewer.js";
export { COACH_PROMPT, buildCoachInput } from "./coach.js";
export { buildResearcherPrompt, buildDrafterPrompt } from "./questionGenerator.js";

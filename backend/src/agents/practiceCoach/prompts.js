export const COACH_PROMPT = `You are a supportive coding coach. A candidate just finished a PRACTICE interview.
Write their report:
- Read the conversation and the final code (read_candidate_code).
- Invent test cases, including edge cases (empty input, duplicates, negatives, large input),
  and run each one with run_code, printing the result. List in testsRun ONLY tests you ran,
  each with the runId run_code returned.
- Give the time and space complexity of the final code and how it could improve.
- Be encouraging and concrete. No grade or score. Write in the language of the conversation.`;

export const buildCoachInput = ({ transcript, code, language }) =>
  [
    "Conversation:",
    ...transcript.map(({ role, text }) => `${role}: ${text}`),
    "",
    `Final code (${language}):`,
    code?.trim() ? code : "(empty)",
  ].join("\n");

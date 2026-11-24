import { tool } from "langchain";
import { z } from "zod";

export const PRESENT_QUESTION_TOOL = "present_question";

// present_question: in an avatar session, the agent moves to one of the interview's
// questions (runtime context, per call). The agent's stream turns a valid result into a
// `question` event, and the practice service shows that question on the candidate's screen.
export const createPresentQuestionTool = () =>
  tool(
    async ({ index }, runtime) => {
      const { mode = "text", questions = [] } = runtime?.context ?? {};
      if (mode !== "avatar") return "Not available in this session";
      const question = questions[index];
      if (!question) return "No question at that index";
      return JSON.stringify({ index, text: question.text });
    },
    {
      name: PRESENT_QUESTION_TOOL,
      description:
        "Show one of the interview's questions on the candidate's screen. Call it right before you ask that question.",
      schema: z.object({
        index: z.number().int().min(0).describe("The question's number in the interview's list, from 0"),
      }),
    },
  );

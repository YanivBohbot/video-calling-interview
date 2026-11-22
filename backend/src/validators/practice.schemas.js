import { z } from "zod";
import { EDITOR_LANGUAGES } from "../integrations/piston/client.js";

const language = z.enum(EDITOR_LANGUAGES, { message: `language must be one of: ${EDITOR_LANGUAGES.join(", ")}` });

export const startPracticeBody = z.object({ language });

export const practiceMessageBody = z.object({
  text: z
    .string({ message: "text (string) is required" })
    .trim()
    .min(1, "text must not be empty")
    .max(4000, "text is limited to 4000 characters"),
  code: z.string().max(50000, "code is limited to 50000 characters").default(""),
  language,
});

export const practiceSessionParams = z.object({ sid: z.string().min(1) });

import { z } from "zod";
import { EDITOR_LANGUAGES } from "../integrations/piston/client.js";

export const runCodeBody = z.object({
  language: z.enum(EDITOR_LANGUAGES, { message: `language must be one of: ${EDITOR_LANGUAGES.join(", ")}` }),
  code: z.string({ message: "code (string) is required" }).max(50000, "code is limited to 50000 characters"),
  stdin: z.string().max(10000, "stdin is limited to 10000 characters").optional(),
});

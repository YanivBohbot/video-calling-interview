import { requiredString } from "./fields.js";
import { z } from "zod";

export const streamTokenQuery = z.object({ userId: requiredString("User ID is required") });

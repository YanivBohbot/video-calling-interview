import { z } from "zod";
import { requiredString, optionalString } from "./fields.js";

const MISSING = "Missing required user fields";

export const createUserBody = z.object({
  name: requiredString(MISSING),
  email: requiredString(MISSING),
  clerkID: requiredString(MISSING),
  profileImage: optionalString("Invalid profileImage"),
});

// The Profile page sends every field, some as null — null means "not set".
export const updateProfileBody = z.object({
  name: requiredString("Name is required"),
  email: optionalString("Invalid email"),
  title: optionalString("Invalid title"),
  bio: optionalString("Invalid bio"),
  phone: optionalString("Invalid phone"),
  timezone: optionalString("Invalid timezone"),
  profileImage: optionalString("Invalid profileImage"),
});

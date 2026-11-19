import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { averageDuration } from "../shared/stats.js";

const renameConflict = (message) => (err) => {
  if (err instanceof ConflictError) throw new ConflictError(message);
  throw err;
};

// The caller's own profile. Rows are created on first sign-in (identity resolver) or,
// for the demo account, by the demo login — there is no public user creation anymore.
export const createUserService = ({ userRepository }) => {
  const getMe = async (principal) => {
    const user = await userRepository.findByClerkId(principal.clerkId);
    if (!user) throw new NotFoundError("User not found");
    return user;
  };

  const updateMe = (principal, { name, email, title, bio, phone, timezone, profileImage } = {}) => {
    if (!name) return Promise.reject(new ValidationError("Name is required"));
    const { clerkId } = principal;
    const fields = {
      name,
      title: title || "",
      bio: bio || "",
      phone: phone || "",
      timezone: timezone || "UTC",
      ...(profileImage && { profileImage }),
    };
    return userRepository
      .upsertProfile(clerkId, {
        update: fields,
        create: { clerkId, email: email || `${clerkId}@talentiq.dev`, ...fields },
      })
      .catch(renameConflict("Email already in use"));
  };

  const getMyStats = async (principal) => {
    const { durations, ...counts } = await userRepository.countInterviewStats(principal.userId);
    return { ...counts, avgDuration: averageDuration(durations) };
  };

  return { getMe, updateMe, getMyStats };
};

import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { averageDuration } from "../shared/stats.js";

const ZERO_STATS = { total: 0, completed: 0, scheduled: 0, cancelled: 0, live: 0, avgDuration: 0 };

const renameConflict = (message) => (err) => {
  if (err instanceof ConflictError) throw new ConflictError(message);
  throw err;
};

export const createUserService = ({ userRepository }) => {
  const createUser = ({ name, email, clerkID, profileImage } = {}) => {
    if (!name || !email || !clerkID) {
      return Promise.reject(new ValidationError("Missing required user fields"));
    }
    return userRepository
      .create({ name, email, clerkId: clerkID, profileImage })
      .catch(renameConflict("User exists"));
  };

  const getByClerkId = async (clerkId) => {
    const user = await userRepository.findByClerkId(clerkId);
    if (!user) throw new NotFoundError("User not found");
    return user;
  };

  const updateProfile = (clerkId, { name, email, title, bio, phone, timezone, profileImage } = {}) => {
    if (!name) return Promise.reject(new ValidationError("Name is required"));
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

  const getStats = async (clerkId) => {
    const user = await userRepository.findByClerkId(clerkId);
    if (!user) return { ...ZERO_STATS };
    const { durations, ...counts } = await userRepository.countInterviewStats(user.id);
    return { ...counts, avgDuration: averageDuration(durations) };
  };

  // Maps a raw clerk id from a request to the internal user id ("demo" = Guest Mode).
  const resolveInterviewerId = async (raw) => {
    if (!raw) return null;
    if (raw === "demo") return (await userRepository.upsertDemoUser()).id;
    const user = await userRepository.findByClerkId(raw);
    return user?.id ?? null;
  };

  return {
    listUsers: () => userRepository.findAll(),
    createUser,
    getByClerkId,
    updateProfile,
    getStats,
    resolveInterviewerId,
  };
};

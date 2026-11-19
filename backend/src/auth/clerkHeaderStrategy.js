import { UnauthorizedError } from "../shared/errors.js";

// Identity strategy contract — every strategy exposes:
//   resolveIdentity(req) → Promise<{ id, name, email, clerkID } | null>
// returning null when the request carries no identity, and throwing an AppError when it
// carries an invalid one. A future OAuth strategy implements the same method and is
// swapped in container.js only; nothing else knows which strategy is in use.
//
// This one trusts the `x-clerk-id` header (or `Authorization: Bearer user:<clerkId>`)
// without verifying it — the behaviour the app had before the refactor.
export const createClerkHeaderStrategy = ({ findUserByClerkId }) => {
  const toIdentity = (user) => ({ id: user.id, name: user.name, email: user.email, clerkID: user.clerkId });

  const resolveIdentity = async (req) => {
    const clerkHeader = req.header("x-clerk-id");
    if (clerkHeader) {
      const user = await findUserByClerkId(clerkHeader);
      if (!user) throw new UnauthorizedError("Invalid clerk id");
      return toIdentity(user);
    }

    const auth = req.header("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      const token = auth.slice(7).trim();
      if (token.startsWith("user:")) {
        const user = await findUserByClerkId(token.split(":", 2)[1]);
        if (user) return toIdentity(user);
      }
    }
    return null;
  };

  return { resolveIdentity };
};

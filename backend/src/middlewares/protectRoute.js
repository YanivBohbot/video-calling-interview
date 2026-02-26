import User from "../models/User.js";

// Simple protection middleware that supports two modes:
// 1) If a valid `x-clerk-id` header (clerkID) is provided, it resolves the user and
//    attaches `req.user = { id, name, email, clerkID }`.
// 2) If `authorization: Bearer <token>` is provided, it tries to parse a naive token
//    of the form `user:<clerkID>` (this is intentionally simple for the example).
// In production, replace the token parsing with verification using Clerk or your auth provider.
export const protectRoute = async (req, res, next) => {
  try {
    const clerkHeader = req.header("x-clerk-id");
    let user = null;

    if (clerkHeader) {
      user = await User.findOne({ clerkID: clerkHeader }).select("-password");
      if (!user) return res.status(401).json({ message: "Invalid clerk id" });
    } else {
      const auth = req.header("authorization") || "";
      if (auth.startsWith("Bearer ")) {
        const token = auth.slice(7).trim();
        // Naive token format: user:<clerkID>
        if (token.startsWith("user:")) {
          const clerkID = token.split(":", 2)[1];
          user = await User.findOne({ clerkID }).select("-password");
        }
      }
    }

    if (!user) return res.status(401).json({ message: "Unauthorized" });

    // attach minimal user info
    req.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      clerkID: user.clerkID,
    };
    return next();
  } catch (err) {
    return res.status(500).json({ message: "Auth error", error: err.message });
  }
};

export default protectRoute;

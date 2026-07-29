import { prisma } from "../lib/db.js";

export const protectRoute = async (req, res, next) => {
  try {
    const clerkHeader = req.header("x-clerk-id");
    let user = null;

    if (clerkHeader) {
      user = await prisma.user.findUnique({
        where: { clerkId: clerkHeader },
        select: { id: true, name: true, email: true, clerkId: true },
      });
      if (!user) return res.status(401).json({ message: "Invalid clerk id" });
    } else {
      const auth = req.header("authorization") || "";
      if (auth.startsWith("Bearer ")) {
        const token = auth.slice(7).trim();
        if (token.startsWith("user:")) {
          const clerkId = token.split(":", 2)[1];
          user = await prisma.user.findUnique({
            where: { clerkId },
            select: { id: true, name: true, email: true, clerkId: true },
          });
        }
      }
    }

    if (!user) return res.status(401).json({ message: "Unauthorized" });

    req.user = { id: user.id, name: user.name, email: user.email, clerkID: user.clerkId };
    return next();
  } catch (err) {
    return res.status(500).json({ message: "Auth error", error: err.message });
  }
};

export default protectRoute;

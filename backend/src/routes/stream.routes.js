import express from "express";
import { StreamClient } from "@stream-io/node-sdk";
// Read directly until the stream module (container-injected config) replaces this router.

const router = express.Router();

// Initialize Stream Client
const streamClient = new StreamClient(process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET);

// Get Stream Token for a user
router.get("/token", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Token expires in 1 hour
    const expirationTime = Math.floor(Date.now() / 1000) + 3600;
    const issuedAt = Math.floor(Date.now() / 1000) - 60;

    const token = streamClient.generateUserToken({
      user_id: userId,
      valid_until: expirationTime,
      issued_at: issuedAt,
    });

    res.status(200).json({ token });
  } catch (error) {
    console.error("Error generating Stream token:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;

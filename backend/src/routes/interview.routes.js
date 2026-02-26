import express from "express";
import Interview from "../models/Interview.js";

const router = express.Router();

// Get all interviews for a specific interviewer
router.get("/", async (req, res) => {
  try {
    // For now, we return all interviews. 
    // In a real app, we would filter by the interviewer's Clerk ID from the auth header.
    const interviews = await Interview.find().sort({ scheduledAt: 1 });
    res.status(200).json(interviews);
  } catch (error) {
    res.status(500).json({ message: "Error fetching interviews", error: error.message });
  }
});

// Create a new interview
router.post("/", async (req, res) => {
  try {
    const newInterview = new Interview(req.body);
    const savedInterview = await newInterview.save();
    res.status(201).json(savedInterview);
  } catch (error) {
    res.status(400).json({ message: "Error creating interview", error: error.message });
  }
});

export default router;

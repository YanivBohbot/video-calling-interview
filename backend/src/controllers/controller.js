import mongoose from "mongoose";
import Interview from "../models/Interview.js";
import User from "../models/User.js";

// helper to accept either a Clerk ID or an ObjectId string and resolve to a User _id
const resolveInterviewerId = async (raw) => {
  if (!raw) return null;
  // If it's a valid ObjectId, return as-is
  if (mongoose.Types.ObjectId.isValid(raw)) return raw;
  // Otherwise try to resolve by clerkID
  const user = await User.findOne({ clerkID: raw });
  return user ? user._id : null;
};

export const listInterviews = async (req, res) => {
  try {
    const rawInterviewer = req.header("x-clerk-id") || req.query.interviewerId;
    const filter = {};
    if (rawInterviewer) {
      const resolved = await resolveInterviewerId(rawInterviewer);
      if (resolved) filter.interviewerId = resolved;
      else return res.status(400).json({ message: "Interviewer not found" });
    }
    const interviews = await Interview.find(filter)
      .sort({ scheduledAt: 1 })
      .populate("interviewerId", "name email clerkID");
    return res.status(200).json(interviews);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error fetching interviews", error: error.message });
  }
};

export const createInterview = async (req, res) => {
  try {
    const rawInterviewer =
      req.header("x-clerk-id") ||
      req.body.interviewerId ||
      req.body.interviewerClerkId;
    const { candidateName, candidateEmail, role, scheduledAt } = req.body;

    if (
      !rawInterviewer ||
      !candidateName ||
      !candidateEmail ||
      !role ||
      !scheduledAt
    ) {
      return res
        .status(400)
        .json({ message: "Missing required interview fields" });
    }

    const interviewerId = await resolveInterviewerId(rawInterviewer);
    if (!interviewerId)
      return res.status(400).json({ message: "Interviewer not found" });

    const newInterview = new Interview({
      interviewerId,
      candidateName,
      candidateEmail,
      role,
      scheduledAt,
    });
    const saved = await newInterview.save();
    return res.status(201).json(saved);
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Error creating interview", error: error.message });
  }
};

export const getInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const interview = await Interview.findById(id).populate(
      "interviewerId",
      "name email clerkID",
    );
    if (!interview)
      return res.status(404).json({ message: "Interview not found" });
    return res.status(200).json(interview);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error fetching interview", error: error.message });
  }
};

export const updateInterviewStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ["scheduled", "live", "completed", "cancelled"];
    if (!allowed.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const updated = await Interview.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    );
    if (!updated)
      return res.status(404).json({ message: "Interview not found" });
    return res.status(200).json(updated);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error updating status", error: error.message });
  }
};

export const deleteInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await Interview.findByIdAndDelete(id);
    if (!removed)
      return res.status(404).json({ message: "Interview not found" });
    return res.status(200).json({ message: "Interview deleted" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error deleting interview", error: error.message });
  }
};

// Light user helpers (kept minimal for this project)
export const createUser = async (req, res) => {
  try {
    const { name, email, password, clerkID, profileImage } = req.body;
    if (!name || !email || !password || !clerkID) {
      return res.status(400).json({ message: "Missing required user fields" });
    }
    const existing = await User.findOne({ $or: [{ email }, { clerkID }] });
    if (existing) return res.status(409).json({ message: "User exists" });
    const user = new User({ name, email, password, clerkID, profileImage });
    const saved = await user.save();
    return res.status(201).json(saved);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Create user failed", error: err.message });
  }
};

export const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    return res.status(200).json(users);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Fetch users failed", error: err.message });
  }
};

export default {
  listInterviews,
  createInterview,
  getInterview,
  updateInterviewStatus,
  deleteInterview,
  createUser,
  getUsers,
};

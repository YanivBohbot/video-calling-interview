import mongoose from "mongoose";

const InterviewSchema = new mongoose.Schema({
  interviewerId: {
    type: String, // Clerk ID of the interviewer
    required: true,
  },
  candidateName: {
    type: String,
    required: true,
  },
  candidateEmail: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    required: true,
  },
  scheduledAt: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ["scheduled", "live", "completed", "cancelled"],
    default: "scheduled",
  },
}, {
  timestamps: true,
});

const Interview = mongoose.model("Interview", InterviewSchema);

export default Interview;

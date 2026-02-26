import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema({
  problem: {
    type: String,
    required: true,
  },
  difficulty: {
    type: String,
    enum: ["easy", "medium", "hard"],
  },
  category: {
    type: String,
    required: true,
  },
  solution: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

const Session = mongoose.model("Session", SessionSchema);

export default Session;

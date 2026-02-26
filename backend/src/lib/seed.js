import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "./db.js";
import User from "../models/User.js";
import Session from "../models/Session.js";
import Interview from "../models/Interview.js";

dotenv.config(); // Loads from the current working directory

const seedData = async () => {
  try {
    const DB_URI = process.env.DB_URL;
    if (!DB_URI) throw new Error("DB_URL not found in .env");
    
    await mongoose.connect(DB_URI);
    console.log("Database connected for seeding...");

    // 2. Clear existing data
    await User.deleteMany({});
    await Session.deleteMany({});
    await Interview.deleteMany({});
    console.log("Existing data cleared.");

    // 3. Seed Sessions (Coding Problems)
    const sessions = await Session.insertMany([
      {
        problem: "Two Sum",
        difficulty: "easy",
        category: "Arrays",
        solution: "function twoSum(nums, target) { ... }"
      },
      {
        problem: "Reverse Linked List",
        difficulty: "medium",
        category: "Linked Lists",
        solution: "function reverseList(head) { ... }"
      },
      {
        problem: "Binary Tree Level Order Traversal",
        difficulty: "hard",
        category: "Trees",
        solution: "function levelOrder(root) { ... }"
      }
    ]);
    console.log(`Seeded ${sessions.length} sessions.`);

    // 4. Seed Interviews
    // We use a dummy clerkId for now. The user can replace this after logging in.
    const dummyClerkId = "user_2test_clerk_id_123"; 
    
    const interviews = await Interview.insertMany([
      {
        interviewerId: dummyClerkId,
        candidateName: "Sarah Johnson",
        candidateEmail: "sarah@example.com",
        role: "Frontend Developer",
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 2), // 2 hours from now
        status: "scheduled"
      },
      {
        interviewerId: dummyClerkId,
        candidateName: "Michael Chen",
        candidateEmail: "michael@example.com",
        role: "Full Stack Engineer",
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // tomorrow
        status: "scheduled"
      },
      {
        interviewerId: dummyClerkId,
        candidateName: "Alex Rivera",
        candidateEmail: "alex@example.com",
        role: "Product Designer",
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 48), // 2 days from now
        status: "scheduled"
      }
    ]);
    console.log(`Seeded ${interviews.length} interviews.`);

    console.log("Seeding completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Seeding failed:", err);
    process.exit(1);
  }
};

seedData();

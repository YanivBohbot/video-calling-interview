import express from "express";
import controller from "../controllers/controller.js";
import aiController from "../controllers/aiController.js";
import { protectRoute } from "../middlewares/protectRoute.js";

const router = express.Router();

// Aggregate routes — must be declared before /:id to avoid shadowing
router.get("/stats", controller.getInterviewStats);
router.get("/activity", controller.getRecentActivity);

// List interviews (optionally filtered by x-clerk-id header or ?interviewerId=)
router.get("/", controller.listInterviews);

// Create a new interview
router.post("/", controller.createInterview);

// AI: generate questions for an interview (must come before generic /:id routes)
router.post("/:id/questions/generate", protectRoute, aiController.generateQuestions);

// Get single interview
router.get("/:id", controller.getInterview);

// Update interview status
router.patch("/:id/status", controller.updateInterviewStatus);

// Update interview notes / status (compte rendu)
router.patch("/:id", controller.updateInterview);

// Delete interview
router.delete("/:id", controller.deleteInterview);

export default router;

import express from "express";
import controller from "../controllers/controller.js";

const router = express.Router();

// List interviews (optionally filtered by x-clerk-id header or ?interviewerId=)
router.get("/", controller.listInterviews);

// Create a new interview
router.post("/", controller.createInterview);

// Get single interview
router.get("/:id", controller.getInterview);

// Update interview status
router.patch("/:id/status", controller.updateInterviewStatus);

// Delete interview
router.delete("/:id", controller.deleteInterview);

export default router;

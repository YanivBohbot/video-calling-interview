import express from "express";
import controller from "../controllers/controller.js";

const router = express.Router();

router.get("/", controller.getUsers);
router.post("/", controller.createUser);

// Profile endpoints — must come before /:id to avoid route shadowing
router.get("/by-clerk/:clerkId", controller.getUserByClerkId);
router.put("/by-clerk/:clerkId", controller.updateUser);
router.get("/by-clerk/:clerkId/stats", controller.getUserStats);

export default router;

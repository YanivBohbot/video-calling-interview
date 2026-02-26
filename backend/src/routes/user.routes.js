import express from "express";
import controller from "../controllers/controller.js";

const router = express.Router();

// List users (no auth for now)
router.get("/", controller.getUsers);

// Create user (minimal)
router.post("/", controller.createUser);

export default router;

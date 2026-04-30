import express from "express";
import controller from "../controllers/controller.js";

const router = express.Router();

router.get("/", controller.listSessions);
router.get("/:id", controller.getSession);

export default router;

import express from "express";
import dotenv from "dotenv";
import { ENV } from "./lib/env.js";
import { connectDB } from "./lib/db.js";
import cors from "cors";
import interviewRoutes from "./routes/interview.routes.js";
import streamRoutes from "./routes/stream.routes.js";
import userRoutes from "./routes/user.routes.js";

import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ENV.CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket.io logic
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);
  });

  socket.on("code-change", ({ roomId, code }) => {
    socket.to(roomId).emit("code-update", code);
  });

  socket.on("language-change", ({ roomId, language }) => {
    socket.to(roomId).emit("language-update", language);
  });

  socket.on("code-execution", ({ roomId, result }) => {
    socket.to(roomId).emit("execution-result", result);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// middelware
app.use(express.json());
app.use(cors({ origin: ENV.CLIENT_URL, credentials: true }));

// Routes
app.use("/api/interviews", interviewRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/users", userRoutes);

console.log(process.env.PORT);

app.get("/health", (req, res) => {
  res.status(200).json({ msg: "success from backedn" });
});

app.get("/books", (req, res) => {
  res.status(200).json({ msg: "success from backedn" });
});

console.log("Starting server with ENV:", ENV);

const startServer = async () => {
  try {
    console.log("Connecting to DB...");
    await connectDB();
    console.log("DB connected, starting HTTP server...");
    httpServer.listen(ENV.PORT, () => {
      console.log(`Server running on port ${ENV.PORT}`);
    });
  } catch (err) {
    console.log("Start server error:", err);
  }
};

startServer();

export default app;

# TalentIQ – Real-Time Technical Interview Platform

TalentIQ is a full-stack real-time technical interview platform that helps recruiters, interviewers, and engineering teams schedule, manage, and conduct remote technical interviews.

The platform combines **live video calls**, **collaborative coding**, **code execution**, **interview scheduling**, and a **system-design whiteboard** into one modern interview workspace.

---

## Table of Contents

- [Overview](#overview)
- [Why This Project](#why-this-project)
- [Main Features](#main-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Flow](#project-flow)
- [Real-Time Collaboration Flow](#real-time-collaboration-flow)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [Running the Project Locally](#running-the-project-locally)
- [Backend API Endpoints](#backend-api-endpoints)
- [Socket.IO Events](#socketio-events)
- [Interview Data Model](#interview-data-model)
- [How to Use the Application](#how-to-use-the-application)
- [Troubleshooting](#troubleshooting)
- [Future Improvements](#future-improvements)
- [Resume Summary](#resume-summary)
- [Author](#author)

---

## Overview

TalentIQ is designed to simulate a real-world remote technical interview environment.

Instead of using separate tools for video calls, coding exercises, scheduling, and system-design discussions, TalentIQ brings everything into a single application.

Users can:

- Sign in or continue in guest mode
- View a dashboard of scheduled interviews
- Create a new interview session
- Join a live interview room
- Use video communication during the interview
- Collaborate on code in real time
- Run code and view execution output
- Use a whiteboard for system-design discussions

---

## Why This Project

Technical interviews usually require multiple disconnected tools:

- Zoom or Google Meet for video
- Google Calendar for scheduling
- CodeSandbox or CoderPad for coding
- Excalidraw or Miro for system design
- Notes or spreadsheets for interview tracking

TalentIQ combines these workflows into one full-stack platform.

This project demonstrates practical experience with:

- Full-stack application development
- Real-time systems
- WebSockets
- Authentication
- Video SDK integration
- Collaborative editing
- Code execution workflows
- MongoDB persistence
- Modern SaaS dashboard design

---

## Main Features

### Authentication

The application uses Clerk for authentication and protected routes.

Users can:

- Sign in
- Access protected dashboard pages
- Continue in guest/demo mode

---

### Interview Scheduling

Users can schedule a new interview by entering:

- Candidate name
- Candidate email
- Role
- Interview date
- Interview time

The interview is saved in MongoDB and displayed in the dashboard.

---

### Interview Dashboard

The dashboard allows users to view and manage interview sessions.

It includes:

- Upcoming interviews
- Interview cards
- Candidate details
- Role information
- Scheduled date and time
- Quick access to interview rooms

---

### Live Video Interview Room

Each interview has a dedicated room.

The interview room includes:

- Live video call
- Participant connection
- Video controls
- Interview workspace layout
- Real-time coding area
- Whiteboard area

Video functionality is powered by Stream Video SDK.

---

### Collaborative Code Editor

The project includes a collaborative coding editor using Monaco Editor and Socket.IO.

The editor supports:

- Real-time code synchronization
- Shared language selection
- Shared execution output
- Multi-user interview rooms
- Multiple programming languages

Supported languages include:

- JavaScript
- TypeScript
- Python
- Java
- C++

---

### Code Execution

Users can run code directly from the editor.

The code execution flow:

1. User writes code in the editor
2. User selects a programming language
3. User clicks run
4. Code is sent to the execution API
5. Output is displayed in the interview room
6. Output can be synchronized with other participants

---

### System Design Whiteboard

The platform includes a whiteboard for system-design interviews.

The whiteboard can be used to:

- Draw architecture diagrams
- Explain distributed systems
- Design APIs
- Sketch database schemas
- Discuss system flows

The whiteboard is powered by tldraw.

---

## Tech Stack

## Frontend

- React
- TypeScript
- Vite
- React Router
- Clerk Authentication
- Stream Video SDK
- Monaco Editor
- Socket.IO Client
- tldraw
- Tailwind CSS
- Framer Motion
- Lucide React
- Axios

---

## Backend

- Node.js
- Express.js
- MongoDB
- Mongoose
- Socket.IO
- Stream Node SDK
- CORS
- dotenv
- Nodemon

---

## External Services

- Clerk for authentication
- Stream for video calls
- MongoDB for database persistence
- Piston API for code execution

---

## Architecture High-Level Architecture Diagram

The application follows a full-stack client-server architecture.

```text

+-----------------------------+
|        React Frontend       |
|-----------------------------|
| Dashboard                   |
| Interview Scheduling        |
| Interview Room              |
| Monaco Code Editor          |
| tldraw Whiteboard           |
| Stream Video UI             |
+-------------+---------------+
              |
              | REST API + Socket.IO
              |
+-------------v---------------+
|      Node.js Express API     |
|-----------------------------|
| Interview Routes            |
| Stream Token Routes         |
| Socket.IO Server            |
| Real-Time Events            |
+-------------+---------------+
              |
              | Mongoose
              |
+-------------v---------------+
|          MongoDB             |
|-----------------------------|
| Interviews Collection       |
+-----------------------------+

External:
- Clerk Authentication
- Stream Video SDK
- Piston Code Execution API

---

## Installation
```bash
git clone https://github.com/YanivBohbot/video-calling-interview.git
cd video-calling-interview
cd backend
npm install
cd frontend
npm install
cd backend
npm run dev
cd frontend
npm run dev
```
















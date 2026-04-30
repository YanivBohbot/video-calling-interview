# TalentIQ — Interview Platform

A full-stack platform for conducting technical interviews with real-time video, collaborative code editing, and whiteboard capabilities.

---

## Features

- **Dashboard** — overview of all interviews, stats, and recent activity
- **Schedule interviews** — create and manage candidate sessions
- **Live interview room** — video call (Stream.io), collaborative Monaco code editor, and tldraw whiteboard
- **Coding problems** — built-in library of sessions with difficulty levels
- **User profiles** — interviewer accounts synced with Clerk authentication
- **Real-time sync** — Socket.io for collaborative editing state

---

## Try It Without an Account

You don't need to create an account to explore the platform.
On the sign-in page, scroll to the bottom and click **Guest Mode (Demo Mode)** to enter the app instantly with a demo user.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Routing | React Router v7 |
| Auth | Clerk |
| Video | Stream.io Video React SDK |
| Code editor | Monaco Editor |
| Whiteboard | tldraw |
| Real-time | Socket.io |
| Backend | Express.js 5 (ESM) |
| Database | PostgreSQL 16 (Docker) |
| ORM | Prisma 6 |
| Job queue | Inngest |

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Clerk](https://clerk.com/) account (for auth)
- [Stream.io](https://getstream.io/) account (for video)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/YanivBohbot/video-calling-interview.git
cd video-calling-interview
```

### 2. Start the database

```bash
docker compose up -d
```

This starts a PostgreSQL 16 container on port **5436** with a persistent named volume (`postgres_data`).

### 3. Configure environment variables

**Backend** — create `backend/.env`:

```env
PORT=3000
DATABASE_URL=postgresql://talentiq:talentiq_secret@127.0.0.1:5436/talentiq

STREAM_API_KEY=your_stream_api_key
STREAM_API_SECRET=your_stream_api_secret

CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

INGEST_API_KEY=your_inngest_api_key

CLIENT_URL=http://localhost:5173
```

**Frontend** — create `frontend/.env`:

```env
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
VITE_STREAM_API_KEY=your_stream_api_key
```

### 4. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 5. Run database migrations

```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
```

### 6. Seed the database (optional)

```bash
cd backend
npm run seed
```

This creates 3 demo users, 3 coding sessions, and 3 sample interviews.

### 7. Start the servers

Open two terminals:

```bash
# Terminal 1 — Backend (http://localhost:3000)
cd backend
npm run dev

# Terminal 2 — Frontend (http://localhost:5173)
cd frontend
npm run dev
```

---

## Project Structure

```
Interview Platform/
├── docker-compose.yml          # PostgreSQL Docker service
├── backend/
│   ├── prisma/
│   │   └── schema.prisma       # Database schema (User, Interview, Session)
│   └── src/
│       ├── server.js           # Express + Socket.io entry point
│       ├── controllers/
│       │   └── controller.js   # All route handlers
│       ├── routes/
│       │   ├── user.routes.js
│       │   ├── interview.routes.js
│       │   ├── session.routes.js
│       │   └── stream.routes.js
│       ├── middlewares/
│       │   └── protectRoute.js # Auth middleware (Clerk header)
│       └── lib/
│           ├── db.js           # Prisma client singleton
│           └── seed.js         # Database seeder
└── frontend/
    └── src/
        ├── App.tsx             # Routes
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Interviews.tsx
        │   ├── NewInterview.tsx
        │   ├── Schedule.tsx
        │   ├── InterviewRoom.tsx
        │   └── Profile.tsx
        ├── components/
        │   ├── CollaborativeEditor.tsx
        │   └── Whiteboard.tsx
        └── layouts/
            └── DashboardLayout.tsx
```

---

## API Reference

Base URL: `http://localhost:3000/api`

### Users

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/users` | List all users |
| `POST` | `/users` | Create a user |
| `GET` | `/users/by-clerk/:clerkId` | Get user by Clerk ID |
| `PUT` | `/users/by-clerk/:clerkId` | Update user profile |
| `GET` | `/users/by-clerk/:clerkId/stats` | Get interview stats for user |

### Interviews

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/interviews` | List interviews (filter by `x-clerk-id` header) |
| `POST` | `/interviews` | Create an interview |
| `GET` | `/interviews/:id` | Get single interview |
| `PATCH` | `/interviews/:id/status` | Update status (`scheduled`, `live`, `completed`, `cancelled`) |
| `DELETE` | `/interviews/:id` | Delete an interview |
| `GET` | `/interviews/stats` | Platform-wide statistics |
| `GET` | `/interviews/activity` | Recent activity feed |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions` | List coding problem sessions |
| `GET` | `/sessions/:id` | Get a single session |

### Stream

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/stream/token?userId=<clerkId>` | Get a Stream.io user token for video |

---

## Database Schema

```
User
 ├── id           (CUID, primary key)
 ├── clerkId      (unique — links to Clerk auth)
 ├── name, email
 ├── profileImage, title, bio, phone, timezone
 └── interviews → Interview[]

Interview
 ├── id           (CUID, primary key)
 ├── interviewerId → User
 ├── candidateName, candidateEmail, role
 ├── scheduledAt  (DateTime)
 ├── status       (scheduled | live | completed | cancelled)
 ├── duration     (minutes, default 60)
 ├── interviewType (technical | behavioral | system-design | coding-challenge)
 └── notes

Session (coding problems)
 ├── id           (CUID, primary key)
 ├── problem, solution
 ├── difficulty   (Easy | Medium | Hard)
 └── category
```

---

## Authentication

The platform uses [Clerk](https://clerk.com/) for user identity. The frontend passes the user's Clerk ID as an `x-clerk-id` header on protected requests. The `protectRoute` middleware validates this against the database.

For local/demo development without Clerk, requests can use:
```
Authorization: Bearer user:<clerkId>
```

---

## Useful Commands

```bash
# View database tables in Docker
docker exec -it <container-name> psql -U talentiq -d talentiq

# Inside psql
SELECT * FROM users;
SELECT * FROM interviews;
SELECT * FROM sessions;
\q   -- quit

# Re-run migrations after schema changes
cd backend && npx prisma migrate dev

# Open Prisma Studio (visual DB browser)
cd backend && npx prisma studio

# Reset database (wipes all data)
cd backend && npx prisma migrate reset
```

---

## Docker

The `docker-compose.yml` at the project root defines a single PostgreSQL service:

- **Image:** postgres:16-alpine
- **Host port:** 5436 → container port 5432
- **Credentials:** `talentiq` / `talentiq_secret`
- **Database:** `talentiq`
- **Persistence:** named volume `postgres_data` (survives container restarts)

```bash
docker compose up -d      # start in background
docker compose down       # stop (data is kept)
docker compose down -v    # stop AND delete all data
```

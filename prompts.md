# Prompts Log — Salon Queue Management System

All prompts executed in OpenAI Codex during the development and deployment of the Salon Queue Management System, in exact chronological order.

---

## Prompt 1 — Repository Setup, Database Schema & Seed Data
Read `AGENTS.md` and every file in `docs/` (`01-brief.md`, `02-screens.md`, `03-flows-rules.md`). Set up the project folder structure with a React + Vite + TypeScript + Tailwind CSS frontend and a Node.js + Express + SQLite + Socket.IO backend. Create the SQLite schema, seed data for the 3 barbers (Ravi, Amit, Imran) and default salon services, and verify both dev servers run cleanly. Do not build the UI screens yet.

## Prompt 2 — REST API & Queue Business Rules
Read `AGENTS.md` and `docs/03-flows-rules.md`. Implement the complete Express REST API and queue business rules: daily sequential token generation (`S-1`, `S-2`, ...), online join validation (10-digit phone, 1+ services, online queue pause check, 30-minute-before-9-PM closing cutoff), walk-in addition, status transitions (`waiting` -> `called` -> `in_service` -> `done` / `no_show`), and wait-time calculation. Add automated API tests for all routes and edge cases.

## Prompt 3 — Real-Time Socket.IO Sync & Bilingual Support (EN / GU)
Read `AGENTS.md` and `docs/02-screens.md`. Integrate Socket.IO so any queue change, status transition, barber toggle, or service/setting update broadcasts real-time state updates to all open screens without page refresh. Add English (`EN`) and Gujarati (`GU`) translation support with a working language toggle on the customer screens.

## Prompt 4 — Customer Screens (`/`, `/join`, `/status/:id`)
Read `AGENTS.md`, `docs/01-brief.md`, and `docs/02-screens.md`. Build the mobile-first Customer Home (`/`), Join Queue (`/join`), and Live Customer Status (`/status/:id`) screens. Include live wait time, active barber chips, multi-service picker with total time and price, sequential token display, and the full-screen gold "It's your turn!" alert when called.

## Prompt 5 — Staff Screens (`/reception`, `/barber/:slug`)
Read `AGENTS.md` and `docs/02-screens.md`. Build the Reception Dashboard (`/reception`) and Barber View (`/barber/ravi`, `/barber/amit`, `/barber/imran`). Include **Call Next**, **+ Add Walk-in**, **Start Service**, **Done**, and **No-Show** actions, barber active/break toggles, and real-time queue updates via Socket.IO.

## Prompt 6 — Waiting Area TV Display (`/display`) & Owner Settings (`/admin`)
Read `AGENTS.md` and `docs/02-screens.md`. Build the Waiting Area TV Display (`/display`) showing currently serving and called tokens in large cards with a gold flash highlight when a token is called, and the Owner Settings (`/admin`) screen to toggle the online queue, toggle barber availability, and manage salon services.

## Prompt 7 — End-to-End Verification & Polish
Read `AGENTS.md` and all files in `docs/`. Run the full test suite, verify every screen (`/`, `/join`, `/status/:id`, `/reception`, `/barber/ravi`, `/display`, `/admin`) works smoothly on mobile and desktop viewports with live Socket.IO updates, and fix any TypeScript, build, or edge-case issues.

## Prompt 8 — Production Deployment Configuration (Vercel + Render / Single-Host)
Configure the app for live deployment: read `VITE_API_URL` (falling back to `window.location.origin`) for all API and Socket.IO calls, normalize trailing slashes, allow the deployed frontend origin via `CLIENT_URL` in Express and Socket.IO CORS, and configure SPA fallback routing so direct URL refreshes work in production.
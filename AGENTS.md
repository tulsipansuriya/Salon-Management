# AGENTS.md — Salon Queue Management System

Queue management web app for a salon: customers join remotely from their phone and track live wait times; receptionists and barbers manage the queue; a waiting-area TV displays live status; the owner configures services, barbers, and queue hours.

## Read First
- `docs/01-brief.md` -> Problem, users, must-have features, and don't-build boundaries
- `docs/02-screens.md` -> Every screen's route, layout, controls, and responsive behavior
- `docs/03-flows-rules.md` -> User flows, queue/barber rules, edge cases, and test checklist

## Tech Stack & Commands
- Frontend: React + Vite + TypeScript + Tailwind CSS
- Backend: Node.js + Express + SQLite + Socket.IO (for instant real-time sync across phone, tablet, and TV windows)
- Run locally: `npm run dev` (concurrently runs frontend and backend)

## Working Rules
- Implement ONLY one build step per task. Do not modify unrelated screens.
- Theme: Dark charcoal (`#1F2937`) background/surfaces + gold (`#D4A017`) accents, rounded cards, minimum 44px tap targets on mobile.
- Bilingual UI: All visible labels must come from a centralized English (`EN`) and Gujarati (`GU`) translation dictionary. Never hardcode UI strings.
- Single source of truth: Keep all queue assignment, status transition, and wait-time rules in backend services/controllers—never trust frontend-only checks.
- Never build features listed in the "Don't Build" section of `docs/01-brief.md`.
- After every task, list all changed/created files and provide exact commands to run and test the changes.
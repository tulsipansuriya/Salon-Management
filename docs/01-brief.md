# Project Brief & Scope — Salon Queue Management System

## Problem
On busy days and weekends, salon customers wait 1–2 hours without knowing when their turn will come. Walk-ins and remote visitors argue about turn order, and receptionists struggle to track barber preferences manually.

## Users
1. **Customers** (mobile phone): Check live wait times, join the queue remotely, and track their turn.
2. **Receptionist** (10-inch tablet): Add walk-in customers, call the next customer for each barber, and handle no-shows or cancellations.
3. **Barbers — Ravi, Amit, Imran** (phone/tablet): View current customer, start/finish haircuts, see who is next, and toggle break status.
4. **Owner** (desktop/tablet): Manage services, barbers on duty, online queue open/close status, and view daily stats.

## Must-Have Features
1. **Home Screen (`/`)**: Live waiting count, estimated wait time, barber availability chips, and quick join button.
2. **Remote Queue Joining (`/join`)**: Select up to 3 services, choose a specific barber or "Any barber (fastest)", enter name + 10-digit phone number.
3. **Live Customer Tracking (`/status/:id`)**: Sequential daily token (`S-1`, `S-2`...), live queue position, dynamic wait countdown, "Start coming" alert at 2nd in line, and full-screen "It's your turn!" alert when called.
4. **Reception Dashboard (`/reception`)**: Walk-in registration, barber assignment via "Call next", no-show marking, and cancellation.
5. **Barber View (`/barber/:name`)**: Active customer timer, Start/Done workflow, next-in-line preview, and Available/On break toggle.
6. **Waiting Area TV (`/display`)**: Full-screen 1920x1080 display showing who is currently with each barber and the next 5 tokens in line.
7. **Owner Settings (`/admin`)**: Enable/disable services (with EN/GU names, duration, price), toggle barbers on duty, open/close online joining, and view today's KPIs.
8. **Bilingual Support**: Instant toggle between English and Gujarati across all screens.

## Don't Build (Out of Scope)
- Online payments or payment gateways
- Future-date/time slot appointment booking
- SMS, WhatsApp, or email notifications
- Customer accounts, passwords, or loyalty points
- Multi-branch support

## Look & Feel
Premium modern salon aesthetic: dark charcoal (`#1F2937`) with warm gold (`#D4A017`) accents, high contrast for TV readability, and clean mobile-first cards in English and Gujarati.
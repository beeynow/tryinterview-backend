# TryInterview Backend

Production-oriented Next.js API for TryInterview with:

- Firebase auth verification
- Secure server session cookies
- Stripe billing and webhook handling
- Neon/PostgreSQL schema and migrations
- Fallback compatibility with the existing Firestore-backed flow while the database is being rolled out

## Database foundation

The backend now includes a normalized Neon/PostgreSQL schema for:

- users and profile data
- secure auth sessions
- subscriptions and webhook events
- interview blueprints, interviews, feedback, and history
- question bank categories and items
- resume uploads and resume analyses
- achievements, certificates, and progress snapshots
- user settings

Migration files live in [`db/migrations/001_platform_foundation.sql`](/home/muhammad/Tryinterview/tryinterview-backend/db/migrations/001_platform_foundation.sql).

## Environment

Copy [`.env.example`](/home/muhammad/Tryinterview/tryinterview-backend/.env.example) to `.env.local` and configure:

- `DATABASE_URL` for Neon/Postgres
- Stripe secrets and price IDs
- Firebase Admin credentials
- frontend URL and cookie settings

## Migrations

When network access is available and dependencies are installed:

```bash
npm install
npm run db:migrate
```

## Session model

The backend supports two auth paths:

1. Firebase bearer tokens for existing frontend API calls.
2. Firebase session cookies plus an app session cookie for hardened browser sessions.

New session endpoints:

- `GET /api/auth/session/csrf`
- `POST /api/auth/session/login`
- `POST /api/auth/session/logout`
- `GET /api/auth/session/me`

## Stripe hardening

Stripe webhooks now record event IDs in the database so duplicate deliveries do not double-apply subscription state.

## Neon CLI note

`npx neonctl@latest init` currently requires a newer Node runtime than the one available in this environment, and the install step also hit a network timeout here. The backend changes in this repo are ready for Neon, but the actual CLI init and package install still need a working network plus Node 22+.

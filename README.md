# TryInterview Backend

Production-oriented Next.js API for TryInterview with:

- Firebase auth verification
- Secure server session cookies
- Stripe billing and webhook handling
- Neon/PostgreSQL schema, bootstrap, and migration scripts
- Postgres as the authoritative application data store when `REQUIRE_DATABASE=true`

## Database foundation

The backend includes a normalized Neon/PostgreSQL schema for:

- users and profile data
- secure auth sessions
- subscriptions and webhook events
- interview blueprints, interviews, feedback, and history
- question bank categories and items
- resume uploads and resume analyses
- achievements, certificates, and progress snapshots
- user settings

Migration files live in `db/migrations/`.

## Environment

Copy `.env.example` to `.env.local` and configure:

- `DATABASE_URL` for Neon/Postgres
- `REQUIRE_DATABASE=true` to disable silent fallback writes in production
- Stripe secrets and price IDs
- Firebase Admin credentials
- frontend URL and cookie settings

`.env.local` is gitignored and is the right place for production-grade local secrets.

## Database setup

Install dependencies and verify the database connection:

```bash
npm install
npm run db:check
```

Apply migrations and seed the question bank reference data:

```bash
npm run db:setup
```

If you only want to apply schema migrations:

```bash
npm run db:migrate
```

## Session model

The backend supports two auth paths:

1. Firebase bearer tokens for existing frontend API calls.
2. Firebase session cookies plus an app session cookie for hardened browser sessions.

Session endpoints:

- `GET /api/auth/session/csrf`
- `POST /api/auth/session/login`
- `POST /api/auth/session/logout`
- `GET /api/auth/session/me`

## Stripe hardening

Stripe webhooks record event IDs in the database to prevent duplicate application of subscription changes, and subscription/customer state is persisted to the database rather than in-memory process state.

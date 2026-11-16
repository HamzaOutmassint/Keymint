# Getting started

This guide takes you from a fresh clone to a running local copy of Keymint.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.22.2+, 24.15.0+, or 26+ | The repository includes an `.nvmrc`. With nvm, run `nvm use`. |
| npm | Bundled with Node.js | |
| Docker | Any recent version with Compose v2 | Used for the local PostgreSQL database |

You can use your own PostgreSQL 16+ server instead of Docker. In that case, set `DATABASE_URL` to point at it.

## 1. Clone and configure

```bash
git clone https://github.com/HamzaOutmassint/Keymint.git
cd Keymint
cp .env.example .env
```

The defaults in `.env.example` work for local development without changes. [Configuration](configuration.md) describes every variable.

## 2. Start PostgreSQL

```bash
docker compose up -d postgres
```

This starts PostgreSQL 17 on `127.0.0.1:5432`, with the user, password, and database all set to `keymint`. If port 5432 is already in use, change `POSTGRES_PORT` and the port in `DATABASE_URL` in your `.env`.

## 3. Install dependencies and set up the database

```bash
npm ci
npm run db:generate   # generate the Prisma client into generated/prisma
npm run db:deploy     # apply all migrations
```

## 4. Add demo data (optional)

```bash
ALLOW_DEMO_SEED=true npm run db:seed
```

This creates a verified demo account with a vault, a few folders, and some sample credentials:

| Field | Value |
|---|---|
| Email | `demo@example.com` |
| Login password | `DemoLoginPass!2026` |
| Master Password | `DemoMasterPass!2026` |

The seed deletes and recreates the demo user's vault each time you run it. It refuses to run when `NODE_ENV=production`. The credentials are public, so only use them on a local database.

## 5. Run the app

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with the demo login password, then unlock the vault with the demo Master Password.

## Creating your own account

Registration is closed by default, and it needs email delivery for verification links. To enable it locally:

1. Create a [Resend](https://resend.com) API key.
2. In `.env`, set `RESEND_API_KEY`, set `RESEND_FROM_EMAIL` to a sender Resend accepts, and set `ENABLE_REGISTRATION="true"`.
3. Restart `npm run dev` and open `/register`.

## Running the checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Some tests need a real database. With PostgreSQL running and migrations applied, include them like this:

```bash
RUN_DATABASE_TESTS=1 npm test
```

> [!CAUTION]
> The database tests create and delete data. Point `DATABASE_URL` at a disposable database.

## Troubleshooting

| Problem | Fix |
|---|---|
| `DATABASE_URL is required for Prisma commands` | Copy `.env.example` to `.env`, or export `DATABASE_URL`. |
| `port is already allocated` when starting Docker | Change `POSTGRES_PORT` and `DATABASE_URL` in `.env`. |
| `/register` redirects to `/login` | Registration is disabled. See [Creating your own account](#creating-your-own-account). |
| The Master Password is rejected | The Master Password is checked against your local vault, not the server. For the demo account, use `DemoMasterPass!2026`. |
| Type errors about `.next/types` | Run `npm run typecheck`, which generates the route types first. |

## Next steps

- [User guide](user-guide.md): what you can do in the app.
- [Architecture](architecture.md): how the pieces fit together.
- [Development](development.md): conventions to follow before you change code.

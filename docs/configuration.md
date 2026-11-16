# Configuration

Keymint is configured entirely through environment variables. In development they are read from `.env`. Start by copying [`.env.example`](../.env.example).

## Environment variables

| Variable | Required in production | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection URL. In development it falls back to `postgresql://keymint:keymint@localhost:5432/keymint`. In production it must include real credentials. The default `keymint:keymint` credentials, placeholder passwords, and explicit TLS downgrade options are all rejected. |
| `POSTGRES_PASSWORD` | Docker only | Password for the `postgres` service in `docker-compose.yml`. It must match the password in `DATABASE_URL`, and must be URL-safe. |
| `POSTGRES_PORT` | No | Host port for the Compose database. The default is `5432`. |
| `APP_PORT` | No | Host port for the Compose app service. The default is `3000`. |
| `BETTER_AUTH_SECRET` | Yes | Secret used to sign sessions and encrypt TOTP material. Use at least 32 random bytes, for example `openssl rand -base64 32`. Placeholders are rejected in production. |
| `BETTER_AUTH_URL` | Yes | Public origin of the app, such as `https://vault.example.com`, with no path. Production requires HTTPS. |
| `NEXT_PUBLIC_APP_URL` | Yes | Must be identical to `BETTER_AUTH_URL`. It is compiled into the client bundle, so it must be set at **build** time. |
| `TRUSTED_PROXY_CIDRS` | No | Comma-separated CIDRs of reverse proxies whose `X-Forwarded-For` headers you trust. Leave it empty to ignore forwarding headers. |
| `ENABLE_REGISTRATION` | Yes | `"true"` or `"false"`. Registration also requires `RESEND_API_KEY`. |
| `ALLOW_DEMO_SEED` | Yes | Must be `"false"` in production. Set it to `"true"` only while running `npm run db:seed` locally. |
| `READINESS_TIMEOUT_MS` | No | Database timeout for `/api/ready`, as an integer from 250 to 30000. The default is 5000. |
| `RESEND_API_KEY` | Yes | [Resend](https://resend.com) API key, used for verification, password reset, email-change, and security emails. |
| `RESEND_FROM_EMAIL` | Yes | Verified sender, such as `Keymint <security@example.com>`. |

### Production validation

When `NODE_ENV=production`, Keymint validates the whole configuration before it serves requests:

- `npm start` runs `npm run production:check` first, through the `prestart` script.
- The server checks the configuration again on startup, in `instrumentation.ts`.

If anything is unsafe, such as a placeholder secret, a non-HTTPS origin, mismatched URLs, or default database credentials, the process exits with a list of the problems. You can run the check yourself with `NODE_ENV=production npm run production:check`.

## Running with Docker Compose

[`docker-compose.yml`](../docker-compose.yml) defines two services:

| Service | Purpose |
|---|---|
| `postgres` | PostgreSQL 17, bound to `127.0.0.1` only |
| `app` | The production build of Keymint. On startup it applies migrations, then serves on `127.0.0.1:${APP_PORT}`. |

For local development you usually only need the database:

```bash
docker compose up -d postgres
```

To run the full stack, first set production values in `.env`. You need HTTPS origins, a real `BETTER_AUTH_SECRET`, a strong `POSTGRES_PASSWORD` that matches `DATABASE_URL`, and working Resend settings. Then run:

```bash
docker compose up -d --build
```

The app container runs as a non-root user on a read-only filesystem, with all Linux capabilities dropped.

## Self-hosting checklist

Keymint protects your vault with browser-side encryption, but a safe deployment still depends on how you run it. At a minimum:

- **Serve it over HTTPS only.** Put Keymint behind a reverse proxy that terminates TLS, such as Caddy, Nginx, or Traefik. Browser crypto and passkeys need a secure context.
- **Preserve the security headers.** Keymint sets a strict Content-Security-Policy with a per-request nonce, `no-store` caching for sensitive responses, and other protective headers. Make sure your proxy or CDN does not strip them or cache pages.
- **Configure `TRUSTED_PROXY_CIDRS`** only for proxies that overwrite or append `X-Forwarded-For`.
- **Keep the database private.** Do not expose PostgreSQL to the internet. Use a dedicated database user with only the privileges it needs.
- **Back up PostgreSQL** regularly, store the backups encrypted, and test that you can restore them. In-app `.kmvault` exports protect individual users, but they do not replace database backups.
- **Run the retention job daily** (see below).
- **Keep dependencies up to date** and rebuild the image when security fixes are released.

## Health checks

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness: the process is running. |
| `GET /api/ready` | Readiness: the database answers within `READINESS_TIMEOUT_MS`. Returns `503` otherwise. |

Neither endpoint returns details about dependencies.

## Data retention job

Run this command at least once a day, for example from cron or a scheduled container:

```bash
npm run security:retention
```

It deletes expired operational data:

| Data | Kept for |
|---|---|
| Activity log entries | 90 days |
| Sync mutation receipts | 7 days |
| Rate-limit counters | 2 days |
| Verification and email-change tokens | Until they expire |

Encrypted vault records and tombstones are never deleted automatically.

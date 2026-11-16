# Development

This guide is for people changing Keymint's code. To get a local copy running first, see [Getting started](getting-started.md).

## Tech stack

| Area | Tools |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict) |
| Styling | Tailwind CSS 4 |
| Authentication | Better Auth, with the two-factor and passkey plugins |
| Database | PostgreSQL 16+ through Prisma 7 and the `pg` adapter |
| Client state | TanStack Query for server-derived data, Zustand for short-lived UI state |
| Forms and validation | React Hook Form and Zod |
| Cryptography | Web Crypto (AES-256-GCM, HKDF), Argon2id through `hash-wasm`, and RFC 8785 canonical JSON |
| Email | Resend |
| Testing | Vitest, Testing Library, jsdom |

> [!NOTE]
> This project uses a recent Next.js release whose APIs can differ from older versions. For example, `proxy.ts` replaces `middleware.ts`. If you are unsure, check the docs bundled in `node_modules/next/dist/docs/`.

## npm scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Generate the Prisma client and build for production |
| `npm start` | Validate the production configuration, then serve the build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Generate Next.js route types, then run `tsc` |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with a coverage report in `coverage/` |
| `npm run db:generate` | Generate the Prisma client in `generated/prisma` |
| `npm run db:migrate` | Create and apply a new migration (development only) |
| `npm run db:deploy` | Apply committed migrations |
| `npm run db:seed` | Create the demo account. Requires `ALLOW_DEMO_SEED=true`. |
| `npm run production:check` | Validate the environment against the production rules |
| `npm run security:retention` | Delete expired operational data |

## Project layout

```text
app/                    Next.js routes
  (auth)/               Sign-in, registration, password reset, Master Password, email-change pages
  (vault)/              Dashboard, folders, search, activity and settings pages
  api/                  Application-owned API routes (see docs/api.md)
components/             Shared layout, providers, icons and UI primitives
features/               Feature modules: UI, schemas and client logic
  vault/                Crypto worker, worker client, unlock gate, sync and import/export
  credentials/          Credential forms, rows, search and password generator
  categories/           Folder UI and validation
  settings/             Security centre, email change, TOTP and passkeys
  security/             Clipboard handling and sensitive-state cleanup
lib/                    Code shared by client and server
  vault-crypto/         Vault protocol: types, encoding, encryption, records, backups
  auth.ts               Better Auth server configuration
  server-env.ts         Environment parsing and production validation
server/                 Server-only code: HTTP helpers, storage, security services
prisma/                 Schema, migrations and the development seed
scripts/                Command-line entry points (production check, retention)
tests/                  Unit, contract, integration and PostgreSQL tests
types/                  Shared view-model types
proxy.ts                Per-request CSP nonce, cache policy and route protection
```

`generated/`, `.next/`, and `coverage/` are build output. They are ignored by git and must never be edited by hand.

## Coding conventions

### API routes

Every application-owned route follows the same pattern, using the helpers in [`server/http.ts`](../server/http.ts):

```ts
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);               // state-changing requests only
    assertVaultProtocolV2(request);          // /api/v2/vault/* only
    const session = await requireSession(request);
    const body = await parseJson(request, schema, 16_384); // max body bytes
    // ...use session.user.id as the owner, never an ID from the body
    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
```

- **Ownership comes from the session.** Every database query must filter by the owner.
- **Validate everything.** Use a strict Zod schema and the smallest reasonable byte limit.
- **Return safe errors.** Expected errors return a status and a safe message. Unexpected errors return only an opaque error ID.
- **Log nothing sensitive.** Never log request bodies, passwords, tokens, ciphertext, SQL, or stack traces.
- **Select explicitly.** Use explicit Prisma `select` clauses so responses never include unintended columns.

### Vault code

- Master Passwords, Recovery Keys, Vault Keys, backup passphrases, and decrypted records **stay in the crypto worker or in the browser's memory**. They must never be sent to the server.
- The server only handles wrappers, opaque encrypted envelopes, revisions, cursors, and mutation IDs. **Do not add plaintext columns or server-side search** for vault content.
- Encrypt the complete record. Use a fresh AES-GCM nonce for every encryption, and authenticate the canonical protected header as additional data.
- Record type, versions, revision, owner, vault, and record IDs are protocol invariants. Changing them requires a protocol version change.

### Client state

- Decrypted vault data lives only in the `decrypted-vault` TanStack Query entry and in component state.
- Locking and signing out must terminate the worker, remove sensitive queries, and reset the Zustand store.
- Never put decrypted data in `localStorage`, `sessionStorage`, IndexedDB, URLs, logs, or server actions.

## Database changes

[`prisma/schema.prisma`](../prisma/schema.prisma) is the source of truth for the data model. Some constraints, such as envelope metadata checks and size limits, are added as raw SQL in migrations because Prisma cannot express them.

To change the schema:

1. Edit `prisma/schema.prisma`.
2. Create a migration against a disposable database:

   ```bash
   npm run db:migrate -- --name short_descriptive_name
   ```

3. Read the generated SQL. Add PostgreSQL `CHECK` constraints by hand if Prisma cannot model a rule.
4. Regenerate the client with `npm run db:generate`.
5. Add tests for the new behaviour, including ownership and validation.

Never edit a migration that has already been merged into `main`. Add a new migration instead.

## Testing

Tests live in [`tests/`](../tests) and are named after the behaviour they protect, for example `vault-sync-pagination.test.ts` or `totp-replay-protection.test.ts`.

| Kind | File pattern | Notes |
|---|---|---|
| Unit and contract tests | `*.test.ts` | Run in Node. No external services. |
| UI integration tests | `*.integration.test.tsx` | Use jsdom and Testing Library. |
| API integration tests | `*.integration.test.ts` | Call route handlers directly, with mocks. |
| PostgreSQL tests | `postgres-*.test.ts` | Skipped unless `RUN_DATABASE_TESTS=1`. They need a migrated, disposable database. |

When you fix a bug, add a regression test to the suite closest to that behaviour. Security-sensitive changes, such as origin checks, ownership, limits, and crypto, need tests that prove the attack is rejected, not just that the normal path works.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and every push to `main`:

1. **Dependency audit**: `npm audit` fails on high or critical advisories. It also runs daily.
2. **Verify**: lint, typecheck, the full test suite (including PostgreSQL tests against a service container), and a production build.

Dependabot opens weekly pull requests for npm updates and monthly ones for GitHub Actions.

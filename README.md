<div align="center">
  <img src="public/logo.png" alt="Keymint logo" width="96" height="96" />

  <h1>Keymint</h1>

  <p>A self-hosted, end-to-end encrypted password manager.</p>

  <p>
    <a href="https://github.com/HamzaOutmassint/Keymint/actions/workflows/ci.yml"><img src="https://github.com/HamzaOutmassint/Keymint/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
    <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
  </p>
</div>

Keymint is a password manager you run on your own server. Your vault is encrypted and decrypted inside a dedicated Web Worker in your browser. The server only stores encrypted records and encrypted key wrappers, so it never sees your Master Password, your Vault Key, or the plaintext of your passwords.

It is built with Next.js, TypeScript, Better Auth, Prisma, and PostgreSQL.

> [!WARNING]
> Keymint is under active development and has not had an independent security audit. Please review the [security model](docs/security-model.md) before you trust it with real credentials.

## Features

- **End-to-end encrypted vault.** AES-256-GCM encryption of every record in the browser, with keys derived using Argon2id.
- **Separate account and vault secrets.** The login password signs you in. The Master Password unlocks the vault. Resetting one never exposes the other.
- **Recovery Key.** Regain access to your vault if you forget your Master Password.
- **Strong account security.** Email verification, TOTP two-factor authentication with recovery codes, passkeys, trusted devices, and session management.
- **Safe email changes.** Both the old and the new address must confirm the change.
- **Encrypted sync.** Revision checks, idempotent mutations, and paginated synchronization keep several devices consistent.
- **Vault Key rotation.** Re-encrypt the whole vault with a new key in the browser, and resume if interrupted.
- **Backups and import.** Encrypted `.kmvault` backups, protected by a passphrase or by your Recovery Key, plus CSV import and export.
- **Everyday tools.** Folders, favourites, local-only search (`Ctrl/⌘ + K`), a password generator, and an activity log.

## Quick start

You need **Node.js 22.22.2+** (or 24.15.0+, or 26+), **npm**, and **Docker**.

```bash
git clone https://github.com/HamzaOutmassint/Keymint.git
cd Keymint
cp .env.example .env

docker compose up -d postgres   # local PostgreSQL 17
npm ci
npm run db:generate
npm run db:deploy

ALLOW_DEMO_SEED=true npm run db:seed   # optional demo account
npm run dev
```

Open <http://localhost:3000> and sign in with the demo account:

| Field | Value |
|---|---|
| Email | `demo@example.com` |
| Login password | `DemoLoginPass!2026` |
| Master Password | `DemoMasterPass!2026` |

These credentials are public. Only use them on a local database.

For more detail, see [Getting started](docs/getting-started.md).

## Documentation

| Guide | What it covers |
|---|---|
| [Getting started](docs/getting-started.md) | Running Keymint locally, step by step |
| [Configuration](docs/configuration.md) | Environment variables, Docker, and self-hosting notes |
| [User guide](docs/user-guide.md) | Using the app: vault, recovery, backups, and account security |
| [Architecture](docs/architecture.md) | Components, trust boundaries, vault lifecycle, and data model |
| [Security model](docs/security-model.md) | Cryptography, threat model, and known limitations |
| [API reference](docs/api.md) | Application-owned HTTP routes and their contracts |
| [Development](docs/development.md) | Project layout, coding conventions, tests, and database changes |

## Contributing

Contributions are welcome: bug reports, documentation fixes, tests, and features. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request, and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

**Found a security vulnerability?** Please do not open a public issue. Follow the private process in [SECURITY.md](SECURITY.md).

## License

Keymint is free software licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version of Keymint as a network service, the AGPL requires you to make your modified source code available to its users.

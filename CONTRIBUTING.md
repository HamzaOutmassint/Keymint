# Contributing to Keymint

Thank you for your interest in Keymint! This guide explains how to propose changes and what we look for in a pull request.

By taking part in this project you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug.** Open an issue using the bug report template.
- **Suggest a feature.** Open an issue using the feature request template, and describe the problem before the solution.
- **Improve the documentation.** Typos, unclear steps, and missing explanations are all worth fixing.
- **Write code or tests.** Issues labelled `good first issue` or `help wanted` are good places to start.

> [!IMPORTANT]
> **Never report a security vulnerability in a public issue.** Follow [SECURITY.md](SECURITY.md) instead.

## Before you start

For anything bigger than a small fix, please open an issue (or comment on an existing one) first, so we can agree on the approach before you spend time on it. This matters most for changes that touch:

- cryptography, the vault protocol, or the browser crypto worker;
- authentication, sessions, or account recovery;
- the database schema or migrations;
- the public API.

## Development setup

Follow [Getting started](docs/getting-started.md) to run Keymint locally. Then read [Development](docs/development.md) for the project layout, coding conventions, and how to work with the database.

## Workflow

1. Fork the repository and create a branch from `main`:

   ```bash
   git checkout -b fix/short-description
   ```

   Use a prefix that describes the change, such as `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, or `chore/`.

2. Make your change. Keep each pull request focused on one topic.
3. Add or update tests. Bug fixes should include a regression test.
4. Update the documentation if you changed behaviour, configuration, or the API.
5. Run every check locally:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

   To include the PostgreSQL-backed tests, start the database and run `RUN_DATABASE_TESTS=1 npm test`.

6. Push your branch and open a pull request against `main`. Fill in the template.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <short summary in the imperative mood>
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, and `ci`. Examples:

```text
feat(vault): add bulk delete for credentials
fix(auth): reject expired email-change tokens
docs: clarify Recovery Key backup steps
```

## Pull request checklist

Reviewers check the following points. Checking them yourself first speeds up review.

- [ ] CI passes (dependency audit, lint, types, tests, build).
- [ ] New behaviour is covered by tests.
- [ ] No plaintext vault data, secrets, or keys reach the server, logs, URLs, or browser storage.
- [ ] Server routes get the owner from the session, check the request origin, and validate input with a strict schema and a size limit.
- [ ] Database changes come with a migration that has been reviewed.
- [ ] Documentation is updated where needed.
- [ ] Tests, fixtures, and screenshots contain no real personal data or credentials.

## Code style

- TypeScript in strict mode. Avoid `any`, and validate external input with Zod.
- ESLint enforces the shared rules: run `npm run lint`.
- Follow the patterns already used in the area you are changing. [Development](docs/development.md#coding-conventions) explains the main ones.

## Licensing of contributions

Keymint is licensed under the [GNU AGPL-3.0](LICENSE). By submitting a contribution, you agree that it is licensed under the same terms.

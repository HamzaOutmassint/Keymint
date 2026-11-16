# Security policy

Keymint stores secrets, so we take security reports seriously and appreciate responsible disclosure.

## Supported versions

Keymint has not had a stable release yet. Security fixes are applied to the `main` branch only.

| Version | Supported |
|---|---|
| `main` | ✅ |
| Anything else | ❌ |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Report them privately through GitHub instead:

1. Go to the repository's [**Security** tab](https://github.com/HamzaOutmassint/Keymint/security).
2. Click **Report a vulnerability**.
3. Fill in the form.

Please include:

- the affected commit or version;
- a description of the issue and its likely impact;
- steps to reproduce it, using **synthetic data only**;
- any proof of concept, and any mitigation you know of.

Never include real passwords, Recovery Keys, vault exports, database dumps, session cookies, or details of someone else's infrastructure.

## What to expect

- We aim to acknowledge your report within **3 business days**.
- We will investigate, keep you informed of our progress, and agree a disclosure date with you.
- Once a fix is released, we will credit you in the advisory unless you would prefer to stay anonymous.

## Scope

In scope: the code in this repository, including the browser crypto worker, the vault protocol, authentication flows, API routes, database migrations, and the supplied Docker configuration.

Out of scope:

- vulnerabilities in a specific self-hosted deployment that come from its own configuration, such as a missing TLS setup or exposed database ports;
- attacks that need an already-compromised device, browser, or browser extension;
- denial of service through traffic volume alone;
- reports from automated scanners without a demonstrated impact.

The [security model](docs/security-model.md) describes what Keymint is and is not designed to protect against.

## Safe harbour

We will not pursue legal action against researchers who act in good faith, respect user privacy, avoid degrading the service, only access data they own, and give us reasonable time to fix an issue before disclosing it.

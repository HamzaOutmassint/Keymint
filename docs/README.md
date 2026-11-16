# Keymint documentation

| I want to... | Read |
|---|---|
| Run Keymint on my machine | [Getting started](getting-started.md) |
| Configure or self-host Keymint | [Configuration](configuration.md) |
| Learn how to use the app | [User guide](user-guide.md) |
| Understand how Keymint works | [Architecture](architecture.md) |
| Understand what Keymint protects against | [Security model](security-model.md) |
| Call or change an API route | [API reference](api.md) |
| Contribute code | [Development](development.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) |

## Glossary

| Term | Meaning |
|---|---|
| **Login password** | The password that signs you in to your Keymint account. The server checks it. |
| **Master Password** | The password that unlocks your vault. It never leaves your browser. |
| **Vault Key** | A random 256-bit key that encrypts every record in your vault. |
| **Recovery Key** | A random key you save during setup. It can unlock your vault if you forget your Master Password. |
| **Wrapper** | The Vault Key encrypted with your Master Password or your Recovery Key. The server stores these. |
| **Record** | One encrypted item in the vault: a credential, a folder, settings, or activity. |
| **Tombstone** | An encrypted marker that a record was deleted, so other devices can sync the deletion. |
| **Crypto worker** | The dedicated Web Worker where all vault encryption and decryption happens. |

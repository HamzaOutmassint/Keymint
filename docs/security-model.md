# Security model

This page explains what Keymint is designed to protect, how it does it, and where its protection ends. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

> [!WARNING]
> Keymint has not been independently audited. Treat it as beta software.

## Goals

During normal operation, the server never receives:

- your Master Password or Recovery Key;
- your Vault Key;
- backup passphrases;
- search terms;
- the decrypted contents of any vault record.

The server stores only encrypted wrappers and encrypted record envelopes, with enough unencrypted metadata to route, sync, and validate them.

The Master Password is never part of a V2 request. This describes the current protocol (Vault Protocol V2). Do not claim retroactive zero knowledge for older V1 data or backups: legacy V1 encrypted backups, which Keymint can still import, may contain plaintext metadata or password-verifier material.

## What Keymint protects against

- **Database theft.** Vault contents are encrypted with a key the server never holds.
- **Stolen backups** that are protected with a strong passphrase or the Recovery Key.
- **Cross-account access.** Ownership comes from the session, and database relations enforce it as well.
- **Tampering with ciphertext or metadata.** AES-GCM authenticates both the ciphertext and the canonical protected header.
- **Request forgery.** State-changing requests must come from the exact app origin.
- **Network attackers**, as long as HTTPS is configured correctly.
- **Accidental server-side plaintext handling.** There is no API that accepts plaintext vault data.

## What Keymint does not protect against

- **A compromised server or build pipeline.** The server delivers the JavaScript that runs in your browser. If the server, a dependency, or a CDN is compromised, it can serve code that captures your secrets as you type them. Browser-side encryption only helps if the code you receive is the code you expect.
- **A compromised device.** Malware, malicious browser extensions, keyloggers, and screen capture are out of scope.
- **Weak or reused passwords.** Encrypted wrappers and passphrase-protected backups can be attacked offline. Their strength depends on your Master Password or passphrase.
- **Secrets copied before a change.** Changing your Master Password does not invalidate old copies of the wrapper or old backups. Use Vault Key rotation if you think the Vault Key itself was exposed.
- **Losing both your Master Password and your Recovery Key.** The vault cannot be recovered.
- **Metadata analysis.** The server can see record counts, sizes, timestamps, revisions, and access patterns.
- **The operator.** Whoever runs the server controls accounts, logs, and backups, although not the vault contents.

## Cryptography

| Purpose | Construction |
|---|---|
| Login password storage (server) | Argon2id: 64 MiB memory, 3 iterations, 1 lane, 32-byte output |
| Master Password and backup passphrase key derivation | Argon2id v1.3 with the same parameters, a 16-byte random salt, and UTF-8 NFC input |
| Recovery key derivation | HKDF-SHA-256, bound to purpose and vault |
| Vault Key and Recovery Key | 256 random bits from the browser's cryptographically secure random number generator. The Recovery Key includes a checksum. |
| Encryption of wrappers, records, and backups | AES-256-GCM, with a fresh 96-bit nonce for every encryption and a 128-bit tag |
| Authenticated metadata | RFC 8785 canonical JSON, used as additional authenticated data |

The Argon2id parameters are part of a versioned profile. Changing them requires a protocol migration.

### Limits

| Item | Limit |
|---|---|
| Plaintext of one record | 64 KiB |
| Records per vault, tombstones included | 2,500 |
| Backup file | 96 MiB file, 64 MiB decrypted archive, 10,000 records |
| CSV import | 4 MB, 500 credentials |

## Account security controls

- Registration is closed by default, and new accounts must verify their email address.
- TOTP secrets and recovery codes are encrypted at rest. Each accepted TOTP code can only be used once.
- Passkeys require user verification. Removing a passkey requires the login password.
- Changing or removing a factor signs out other sessions and trusted devices.
- Password confirmations are rate-limited to 5 attempts per 5 minutes per account.
- Email change tokens are single-use, expire after one hour, and are stored only as SHA-256 hashes.
- Forwarded client IP addresses are ignored unless `TRUSTED_PROXY_CIDRS` is set. Stored IP addresses are reduced to coarse ranges.

## Best-effort protections

Some protections depend on the browser and the operating system, and cannot be guaranteed:

- **Clipboard clearing.** Keymint tries to clear a copied password after 30 seconds, but the operating system or a clipboard manager may keep a copy.
- **Memory erasure.** JavaScript cannot guarantee that keys are erased from memory. The worker is terminated on lock to limit exposure.
- **CSV exports** are plaintext by design. Prefer encrypted `.kmvault` backups. CSV leaves out third-party recovery codes.

## Third-party recovery codes

Recovery codes for other services are stored in an optional `recoveryCodes` field inside the encrypted credential payload. They are covered by the same AES-GCM record encryption, sync, backup, and rotation as every other credential field. The server cannot tell whether a credential has codes, except through the record size.

- The `.txt` file or pasted text is parsed in the browser. Only the encrypted record is uploaded.
- Records are strictly validated. A set holds 1 to 64 unique codes of up to 128 characters, without control characters. When a credential has no codes, the field is left out entirely, so records written before this feature are unchanged.
- The activity log records only that codes were viewed (`RECOVERY_CODES_VIEWED`) or copied (`RECOVERY_CODE_COPIED`), never the codes themselves.
- Copied codes use the same best-effort 30-second clipboard clearing as passwords.

## Known limitations and future work

- No independent cryptographic or security audit has been done yet.
- Encrypted tombstones are never purged automatically, and they count toward the record limit.
- The web app has no mechanism, such as a browser extension or signed releases, to check that the served JavaScript matches the published source.

Contributions in these areas are especially welcome. Please open an issue to discuss your approach first.

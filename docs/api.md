# API reference

This page documents Keymint's **application-owned** HTTP routes. Authentication flows such as sign-in, sign-up, password reset, TOTP challenges, passkeys, and sessions are handled by Better Auth under `/api/auth/*`. UI code should use the typed client in [`lib/auth-client.ts`](../lib/auth-client.ts) for those, rather than building requests by hand.

## Conventions

### Authentication

Every route requires a Better Auth session cookie, except `/api/health`, `/api/ready`, and public Better Auth flows. The user is always identified from the session. The server never takes a user ID from the request.

### Origin check

`POST`, `PUT`, `PATCH`, and `DELETE` requests must send an `Origin` header that exactly matches the configured app URL. Missing, `null`, or cross-site origins are rejected with `403`.

### Vault protocol header

Every `/api/v2/vault/*` request must include this header, or the server returns `426`:

```http
Keymint-Vault-Protocol: 2
```

### Request bodies

Send JSON with `Content-Type: application/json`. Each route has a byte limit, which is enforced while the body is streamed, and a strict schema. Unknown fields are rejected.

### Response format

```jsonc
// Success
{ "data": { /* ... */ } }

// Expected error
{ "error": "Safe message", "details": { /* optional */ } }

// Unexpected error
{ "error": "An unexpected error occurred", "errorId": "<uuid>" }
```

Sensitive responses are sent with `Cache-Control: no-store`.

### Status codes

| Status | Meaning |
|---|---|
| `200` / `201` | Success / created |
| `400` | Malformed JSON, invalid query, or schema failure |
| `401` | No session, or wrong password confirmation |
| `403` | Bad origin, the sign-in is too old for a sensitive action, or the action is not allowed |
| `404` | The resource does not exist or belongs to someone else |
| `409` | Conflict: the vault already exists, or a revision or wrapper is stale |
| `410` | Pending TOTP enrollment expired |
| `413` | Request body too large |
| `422` | Invalid or mismatched cryptographic envelope |
| `426` | `Keymint-Vault-Protocol: 2` header missing |
| `429` | Rate limited. See the `Retry-After` header. |
| `500` | Unexpected error. The response includes an `errorId`. |

## Health

| Method | Route | Response |
|---|---|---|
| `GET`, `HEAD` | `/api/health` | `200 {"status":"ok"}` while the process is alive |
| `GET`, `HEAD` | `/api/ready` | `200 {"status":"ready"}` if the database answers in time, otherwise `503` |

## Profile and activity

| Method | Route | Body / query | Notes |
|---|---|---|---|
| `PATCH` | `/api/profile` | `{ name, image? }` | Updates the profile only. Email cannot be changed here. |
| `GET` | `/api/logs` | `?q=&page=` | 25 entries per page. The search text is capped at 200 characters. |
| `POST` | `/api/logs/event` | `{ action: "LOGIN" \| "LOGOUT" }` | 10 requests per minute |
| `GET` | `/api/logs/export` | None | Downloads up to 10,000 entries as JSON |

## Account security

| Method | Route | Body | Notes |
|---|---|---|---|
| `POST` | `/api/security/reauth` | `{ password }` | Confirms the login password and refreshes the session's sign-in time |
| `POST` | `/api/security/totp/enrollment` | `{ password }` | Starts TOTP enrollment. Returns the URI, recovery codes, and expiry. |
| `PUT` | `/api/security/totp/enrollment` | `{ code }` | Activates the pending factor and signs out other sessions |
| `POST` | `/api/security/passkeys/delete` | `{ id, password }` | Deletes a passkey and signs out other sessions |
| `GET` | `/api/security/email-change/request` | None | Returns the pending email change, if any |
| `POST` | `/api/security/email-change/request` | `{ newEmail, password }` | Starts an email change and emails the current address. 3 per hour. |
| `DELETE` | `/api/security/email-change/request` | None | Cancels the pending change |
| `POST` | `/api/security/email-change/resend` | None | Resends the current step's email. 3 per hour. |
| `POST` | `/api/security/email-change/verify-current` | `{ token }` | Confirms the current address, then emails the new address |
| `POST` | `/api/security/email-change/verify-new` | `{ token }` | Completes the change and signs out every session |

Password confirmations on these routes share a limit of 5 attempts per 5 minutes per account. Email-change tokens are carried in the URL fragment, so the browser never sends them to the server during navigation. They are single-use and expire after one hour.

## Vault (protocol V2)

All vault payloads are opaque to the server. It validates their structure and routing metadata, but it cannot decrypt them.

### Wrapper format

```json
{
  "protected": { "...": "public, authenticated header" },
  "nonce": "base64url",
  "ciphertext": "base64url"
}
```

### Setup, unlock and recovery

| Method | Route | Body | Notes |
|---|---|---|---|
| `POST` | `/api/v2/vault/setup` | `{ masterWrapper, recoveryWrapper }` | Creates the vault. Max 16 KiB. Returns `201`. |
| `GET` | `/api/v2/vault/bootstrap` | None | Returns the KDF parameters, salt, and master wrapper needed to unlock |
| `PUT` | `/api/v2/vault/wrappers/master` | `{ masterWrapper }` | Changes the Master Password. Needs a sign-in from the last 5 minutes. |
| `GET` | `/api/v2/vault/recovery` | None | Returns both wrappers for local recovery |
| `PUT` | `/api/v2/vault/recovery` | `{ masterWrapper, recoveryWrapper }` | Replaces both wrappers after recovery. Max 32 KiB. Needs a recent sign-in. |

Example `GET /api/v2/vault/bootstrap` response:

```json
{
  "data": {
    "protocolVersion": 2,
    "kdf": {
      "name": "argon2id",
      "version": 19,
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1,
      "outputBytes": 32,
      "passwordEncoding": "UTF-8-NFC",
      "profile": "KM-ARGON2ID-64M-3T-1P-V1"
    },
    "salt": "base64url",
    "wrappedVaultKey": { "protected": {}, "nonce": "base64url", "ciphertext": "base64url" }
  }
}
```

### Records

A record envelope looks like this:

```json
{
  "protected": {
    "application": "Keymint",
    "format": "keymint-vault-record",
    "protocolVersion": 2,
    "envelopeVersion": 2,
    "encryptionVersion": 2,
    "payloadVersion": 1,
    "cipher": "A256GCM",
    "purpose": "vault-record",
    "ownerId": "<session user id>",
    "userId": "<session user id>",
    "vaultId": "<uuid v4>",
    "recordId": "<id>",
    "recordType": "credential | category | vaultSettings | vaultActivity | tombstone",
    "keyVersion": 1,
    "revision": "1",
    "state": "active | deleted"
  },
  "nonce": "base64url",
  "ciphertext": "base64url"
}
```

| Method | Route | Body / query | Notes |
|---|---|---|---|
| `POST` | `/api/v2/vault/records` | `{ mutationId, envelope }` | Creates a record at revision `1`. Max 128 KiB. Returns `201`. |
| `GET` | `/api/v2/vault/records/:id` | None | Fetches one envelope |
| `PUT` | `/api/v2/vault/records/:id` | `{ mutationId, expectedRevision, envelope }` | Writes the next revision. Max 128 KiB. |
| `DELETE` | `/api/v2/vault/records/:id` | `{ mutationId, expectedRevision, envelope }` | Writes an encrypted tombstone. Max 128 KiB. |
| `POST` | `/api/v2/vault/records/batch` | `{ mutationId, records: [{ expectedRevision, envelope }] }` | 1 to 100 records with unique IDs. Max 8 MiB. |
| `GET` | `/api/v2/vault/sync?cursor=N` | Non-negative integer cursor | Up to 500 changed records, a new `cursor`, and `hasMore` |

- `mutationId` is a UUID. Retrying with the same ID returns the original response. Receipts are kept for 7 days.
- Revisions are decimal strings. Creating a record uses `expectedRevision: null`. If the revision is stale, the server returns `409`.
- Keep calling `sync` while `hasMore` is `true`. If a record ID appears again on a later page, the later version wins.
- A vault can hold at most 2,500 records, tombstones included.

### Vault Key rotation

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/v2/vault/rotation` | Read the current rotation checkpoint |
| `POST` | `/api/v2/vault/rotation` | Begin or restart a rotation with new wrappers. Needs a recent sign-in. |
| `PUT` | `/api/v2/vault/rotation/records` | Stage up to 100 re-encrypted records. Safe to retry. |
| `POST` | `/api/v2/vault/rotation/commit` | Swap the records, wrappers, and key version atomically. Needs a recent sign-in. |
| `DELETE` | `/api/v2/vault/rotation?rotationId=…` | Abort and discard the staged data |

Any normal vault write during a rotation invalidates it, and the commit is then rejected without changing the live key.

## Better Auth routes

These are served by the catch-all `/api/auth/[...all]` handler and used through `authClient`:

- email sign-up, verification, sign-in, and sign-out;
- password reset and login-password change;
- TOTP and recovery-code challenges, trusted devices, disabling TOTP, and regenerating recovery codes;
- passkey sign-in, registration, and listing;
- listing and revoking sessions.

Better Auth's own email-change, TOTP-enable, and passkey-delete endpoints are **disabled**. Keymint's security routes above replace them.

/**
 * A hard account-level ceiling for stored encrypted records, including
 * tombstones. Record ciphertext is independently capped at 65,552 bytes by
 * the vault protocol/database checks, so this also bounds decoded ciphertext
 * to less than 157 MiB and Base64url ciphertext storage to less than 209 MiB
 * per vault.
 */
export const MAX_VAULT_RECORDS = 2_500;

/** Keep sync responses comfortably below ordinary proxy response limits. */
export const VAULT_SYNC_PAGE_SIZE = 500;

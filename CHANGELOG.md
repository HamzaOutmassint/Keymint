# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- First public release of the Keymint source code.
- End-to-end encrypted vault (Vault Protocol V2), with browser-side encryption in a dedicated Web Worker.
- Account security: email verification, TOTP with recovery codes, passkeys, trusted devices, session management, and two-step email changes.
- Recovery Key, Master Password change, and resumable Vault Key rotation.
- Encrypted `.kmvault` backups, plus CSV import and export.
- Folders, favourites, local search, a password generator, and an activity log.
- Third-party 2FA recovery codes on credentials. You can upload or paste a service's `.txt` file, which is parsed in the browser with an editable preview. Codes are stored inside the encrypted credential, can be marked as used, show a remaining-count badge, and produce `RECOVERY_CODES_VIEWED` and `RECOVERY_CODE_COPIED` activity events. They are included in `.kmvault` backups but not in CSV. Requires the `20261117120000_recovery_code_activity` migration. Reload open tabs after upgrading: an older build cannot read credentials that hold codes.

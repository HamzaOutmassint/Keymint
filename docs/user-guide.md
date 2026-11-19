# User guide

This guide explains how to use Keymint, and how account access, vault access, recovery, and backups relate to each other.

## Your two passwords

Keymint uses two separate secrets:

| | Login password | Master Password |
|---|---|---|
| **What it does** | Signs you in to your account | Unlocks your vault |
| **Where it is checked** | On the Keymint server | Only in your browser |
| **If you forget it** | Reset it by email | Use your **Recovery Key** |

Resetting your login password does **not** unlock or reset your vault. If you lose both your Master Password and your Recovery Key, nobody can recover your vault, including the server operator.

## Create an account

Registration is available only if the operator has enabled it. If `/register` sends you back to the sign-in page, registration is closed.

1. Open **Create account**, then enter your name, email address, and a login password of 12 to 128 characters.
2. Click the verification link sent to your email. It expires after one hour.
3. Sign in.

## Sign in

You can sign in with your login password or with a passkey.

- **Keep me signed in** keeps the session for up to 7 days. Don't use it on shared devices.
- If you have two-factor authentication enabled, enter the 6-digit code from your authenticator app, or a recovery code.
- **Trust this device** skips the second factor on this device for up to 14 days.
- Forgot your login password? Use **Forgot password?** to get a one-hour reset link.

## Set up your vault

The first time you sign in, Keymint asks you to create a vault:

1. Choose a **Master Password** of at least 12 characters. A long passphrase is best. Don't reuse your login password.
2. Keymint generates your **Recovery Key**. Download it or write it down, and store it somewhere safe and separate from this device.
3. Type the Recovery Key back in to confirm you saved it.

The Recovery Key is shown only once.

## Unlock and lock

After you sign in, enter your Master Password to unlock the vault. The password is checked locally. It is never sent to the server.

The vault locks automatically when:

- there has been no activity for 15 minutes;
- the tab has been hidden for 5 minutes;
- you leave the page, or it is restored from the browser's back/forward cache;
- another tab changes your vault's access settings;
- you sign out.

## Recover with your Recovery Key

1. Sign in to your account.
2. On the unlock screen, choose **Use Recovery Key**.
3. Paste your Recovery Key (it starts with `KMV2-RK`) or import its file.
4. Choose a new Master Password.
5. Save the **new** Recovery Key that Keymint generates, then confirm it.

Your old Master Password and old Recovery Key stop working.

If Keymint asks you to sign in again before saving, that is expected: sensitive changes need a sign-in from the last 5 minutes.

## Manage passwords

Click **Add new password** in the sidebar, or the **+** button on mobile. Each entry can have a name, username, email, website, password, folder, notes, and a favourite flag. The built-in generator creates random passwords with the length and character types you choose.

For each entry you can reveal or copy the password, edit it, mark it as a favourite, or delete it. Copied passwords are cleared from the clipboard after 30 seconds where the browser allows it.

### Recovery codes

When you turn on two-factor authentication for another service, it usually gives you a list of one-time recovery codes, often as a `.txt` file. To keep them in Keymint:

1. Edit the matching entry (or create one) and click **Add codes** under **Recovery codes**.
2. Drop the `.txt` file onto the panel, choose it, or paste the codes. The file is read in your browser and never uploaded.
3. Check the detected codes. You can fix or remove any of them, and add back lines Keymint skipped, such as a code with no digits.
4. Click **Use these codes**, then save the entry.

Entries with codes show how many are left, such as **7/10 codes**. Click the key icon on the entry to see the list. From there you can copy a code, mark it as used, download the unused codes, or replace the whole set when the service gives you new ones. Keymint warns you when two or fewer codes, or 20% or less, remain.

Recovery codes are included in encrypted `.kmvault` backups but **not** in CSV exports.

## Folders and search

- **Dashboard** shows your counts, recent entries, and favourites.
- **Folders** can be created, renamed, sorted, and deleted. Deleting a folder keeps its passwords; they just become uncategorised.
- **Search** looks through names, usernames, emails, websites, notes, and folder names. It runs entirely in your browser. Open it with `Ctrl + K` on Windows and Linux, or `⌘ + K` on macOS.

## Account security settings

Open **Settings** to:

- update your name and profile picture;
- change your login password, which signs out other sessions;
- change your email address (both the old and the new address must confirm);
- set up, replace, or remove an authenticator app, and regenerate recovery codes;
- add or remove passkeys;
- review and revoke active sessions;
- change your Master Password;
- rotate your Vault Key.

### Change Master Password vs. rotate Vault Key

- **Change Master Password** re-encrypts only the key that protects your vault. It is fast, and it is the right choice for a routine password change.
- **Rotate Vault Key** re-encrypts your whole vault with a brand-new key and gives you a new Recovery Key. Use it if you think your vault key or an old backup may have been exposed. Keep the page open until it finishes. If you edit the vault while it runs, the rotation restarts safely and your old key stays active.

## Back up and export

Exports are created in your browser while the vault is unlocked.

| Format | Protected by | Use it for |
|---|---|---|
| Encrypted `.kmvault` | A backup passphrase you choose | Regular backups |
| Recovery `.kmvault` | Your current Recovery Key | Backups you can open with your Recovery Key |
| CSV | **Nothing: it is plaintext** | Moving your data to another password manager |

Use a strong, unique backup passphrase. Treat CSV files as highly sensitive, and delete them once you are done.

## Import

**Settings → Import** accepts `.kmvault`, `.json`, and `.csv` files. Files are processed in your browser and never uploaded unencrypted.

- Encrypted backups need their passphrase or Recovery Key.
- CSV files must use Keymint's column headers, and are limited to 4 MB and 500 entries.
- When a duplicate is found (same name and username), you can choose to **skip** or **replace** it.

Keep the page open until the import finishes, then create a fresh encrypted backup.

## Activity log

The **Activity** page lists recent account events, with approximate device, browser, and location information. You can filter the list or export it as JSON. Entries are kept for 90 days.

## Troubleshooting

| Problem | What to do |
|---|---|
| `/register` sends me to sign in | Registration is disabled on this server. Ask the operator. |
| No verification or reset email | Check your spam folder, then ask the operator to check the email configuration. |
| My Master Password doesn't work | Try your Recovery Key. Resetting your login password won't help. |
| I'm asked to sign in again before saving | Sign out, sign back in, and repeat the action within 5 minutes. |
| An import was rejected | Check the file type, the passphrase or key, the CSV headers, and the size limits. |

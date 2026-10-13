# Publishing safely

The public GitHub repository's fetched history currently contains only the initial README. No credentials were found in fetched commits, staged content or publishable working files during the October 13, 2026 check. This describes the inspected history, not deleted remote history, forks or files shared outside Git.

Before committing or publishing:

```powershell
npm run check:secrets
npm run test:secrets
```

The scanner checks tracked/unignored files, staged bytes and all fetched/local commits. It detects common private keys, service-account credentials, provider tokens, sensitive environment assignments and accidental copies of the actual local moderator password. It reports only paths/categories, never credential values. It also rejects sensitive files force-added despite exclusions. Pattern matching cannot detect every possible secret; review the staged diff as well.

A local pre-commit hook is enabled for this checkout. For a new clone, run `npm run security:install-hook` after installing Node. The installer sets executable permissions and refuses to replace another configured hook directory; integrate the scan into an existing hook if needed. Git hooks can be bypassed and are not automatically active in other clones. The hook performs the same scan without publishing anything.

The exclusions cover `.env` files except the blank `.env.example`, `*.local.*`, moderator credentials, diagnostic/emulator logs, auth/service-account exports, private keys/certificates, test artifacts, builds, DJ state/backups and source audio. Saved DJ state contains local paths and library information. Never force-add these files, upload your complete workspace as a ZIP, or place private credentials in release attachments.

Firebase project/app IDs and the guest URL are public identifiers. Firebase's client web configuration is shipped to browsers by design; it does not confer DJ/admin permission. Access is controlled by Firebase Authentication, the verified DJ claim and Firestore rules. Keys reused for non-Firebase Google APIs need appropriate API restrictions. See [Firebase API key guidance](https://firebase.google.com/docs/projects/api-keys). Never put a DJ password, Admin SDK/service-account key, CLI refresh token or signing key in `VITE_*` variables: those variables are bundled into public code.

The administrator setup scripts contain no embedded credentials. They use the operator's existing Firebase CLI account on that operator's machine. Publishing their source does not publish your CLI session. Do not publish CLI config or debug output.

If a real credential was previously exposed, ignoring or deleting the file does not undo the exposure: revoke/rotate it first, then clean history and contact GitHub support if necessary. No exposed credential requiring rotation was detected in this inspection. The guest request board remains intentionally public, with basic per-anonymous-session spam limits rather than proof of guest identity.

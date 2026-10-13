# Guest requests without Cloud Functions

The active implementation uses Firebase Hosting, basic Firebase Authentication and Firestore on the free Spark plan. Guests receive an anonymous session automatically; they do not create an account. Browser and desktop clients write Firestore transactions directly. Security rules validate the song, private vote receipt and participant counter together before committing. No Cloud Functions are deployed or required. The previous code in `functions/` is inactive and absent from `firebase.json`.

## Current deployment

Project: **wedding-dj-console-2026**. Guest URL: https://wedding-dj-console-2026.web.app/guest.html. Wedding: **October 24, 2026**. Billing is disabled with no linked account. Authentication is initialized; Anonymous and Email/Password sign-in are enabled. The October 24 event is open, rules are deployed, and the guest page is connected. The title deletes and types all ten requested phrases; reduced-motion users see a static title.

## Configuration and deployment

1. In the Firebase console, enable basic Authentication using **Get started**, then Anonymous and Email/Password providers. Do not upgrade to Identity Platform or enable billing for this application.
2. Use a default Firestore database. Copy `.env.example` to `.env.local` and fill the public web-app configuration. Desktop and guest builds must share `VITE_EVENT_ID=wedding-2026-10-24`. Set `VITE_GUEST_PREVIEW=false` when connected. `VITE_GUEST_URL` supplies the initial QR link without replacing a saved URL.
3. Create `events/wedding-2026-10-24` with boolean `open=true`. Set false to close submissions and voting. Moderation remains available when closed; the event document is private to DJs.
4. Create a DJ Email/Password user and assign its UID custom claim `{dj:true}` using a trusted Admin SDK or management API. Never put administrator credentials in the app. Sign into the desktop request panel. Passwords are not stored in the DJ state file; Firebase can retain its own auth session. Sign out on shared equipment.

For this project, `scripts/firebase-cloud.mjs` uses the CLI's signed-in account to configure providers/public client settings (`provision`), open the event (`event`), assign the DJ claim (`moderator`) and check billing (`status`). A newly created moderator's temporary credentials are saved only in ignored `DJ_ACCESS.local.md`. It never links billing or initializes paid Identity Platform.

```powershell
npx firebase login
node scripts/firebase-cloud.mjs provision
node scripts/firebase-cloud.mjs event
node scripts/firebase-cloud.mjs moderator
npm run test:firebase
npm run build:guest
npx firebase deploy --only "firestore:rules,hosting" --project wedding-dj-console-2026
npm run dist:win
```

Rebuild the desktop after changing build-time configuration. Open **Guest QR** and scan on a phone using mobile data. Generating a QR does not verify service availability.

## Rules and limits

- Title and artist: 1–120 characters, trimmed, no controls or HTTP links. Client cleanup normalizes Unicode/whitespace; rules independently validate stored text. A form honeypot rejects basic bots.
- Duplicate identity: SHA-256 of lowercase, punctuation-free Unicode letters/numbers in title and artist, independently recomputed by rules. Normalized duplicates add a vote rather than another request. Different spellings are not fuzzy-matched.
- Per anonymous UID: 5 submissions per event, 30 seconds apart; 50 explicit votes, 2 seconds apart. A receipt prevents repeat votes for a song. New submissions supply the first vote. Duplicate submissions consume the submission allowance.
- Rules enforce counters, cooldowns, timestamps and receipt/song relationships atomically. Guests cannot edit moderation, reset quotas, fabricate identifiers, delete documents or read another guest's private records. Guests can read their own counter/receipt. Public songs contain no guest identity.
- Only the DJ claim permits approval, rejection, marking played and priority 0–1000. No request downloads audio or enters playback automatically. The DJ chooses local music manually.
- The board shows the newest 200 requests, sorted locally. The UI hides rejected songs; their display documents remain publicly readable. Do not submit sensitive information.

Per-UID limits are basic spam protection: a new anonymous session can evade them. App Check is optional and **not enforced or verified in this deployment**. Global Firestore App Check enforcement would also affect the Electron moderator and needs a tested desktop strategy. Monitor usage and close the event if abused. Spark quotas can make requests unavailable; local audio remains independent. See [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## Local emulator tests

Use Java 21+ and root npm dependencies. Temurin 21 is installed here; Java is only needed for testing.

```powershell
npm run test:rules
npm run test:firebase
```

The full suite starts Auth on 9099 and Firestore on 8080, bound to localhost in isolated project `demo-wedding-dj`. No production credentials are needed. The launcher stops emulators afterward and detects the default Windows Temurin installation. The first run may download the Firestore JAR.

**29 tests passed:** 15 permissions tests, 13 direct transaction/adversarial rules tests and one actual Auth-emulator test with separate anonymous sessions and live listeners. Coverage includes Unicode duplicates, replay, concurrency, quota/cooldown bypass, fabricated IDs/timestamps, extra batched votes, closed events, immutable fields and DJ moderation. Results: `test-results/firestore-rules.json`.

Emulator success does not establish production Auth, deployed rules or actual phone access. Rules validate atomic writes with `getAfter()` as described in [Firebase transaction documentation](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Live verification and rehearsal

`node scripts/firebase-live-smoke.mjs` explicitly targets this production project. It creates one clearly labeled test request, signs in two anonymous clients and the DJ, verifies votes/listeners and moderator permissions, and leaves its fixture rejected. It reads ignored local configuration/credentials without printing secrets. Evidence is written to `test-results/firebase-live.json` on success. Do not run it repeatedly as a load test.

Before the reception, use actual phones to submit, duplicate-submit, vote, hit cooldown, approve, prioritize, reject, mark played and test a closed event. Scan the printed QR. Disconnect the desktop network while music plays and confirm audio continues. Keep playback troubleshooting independent of the guest network.

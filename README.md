# Wedding DJ Console

An offline-first Windows reception console for **October 24, 2026**. Electron + React + TypeScript; two streaming audio decks feed a shared Web Audio mixer. Optional Firebase guest requests never control playback.

## Run locally

Use Windows 10/11 (64-bit), Node.js **24.9 or newer** and npm. From this directory:

```powershell
npm ci
npm run dev
```

For a production build without the development server:

```powershell
npm run build
npx electron .
```

`npm run dev:web` is a browser UI preview. It deliberately cannot import arbitrary local files or pretend to provide durable desktop playback.

## Windows distribution

```powershell
npm run dist:win
```

Builds an NSIS installer and a portable executable in `release/`. `npm run pack:win` makes an unpacked application. Builds are unsigned unless you configure your own Electron Builder signing credentials; Windows may display a SmartScreen warning. Install and rehearse the exact build on the reception laptop before using it at the event.

## DJ workflow

1. Connect the laptop to power and select the reception audio device in Windows before starting. Import files or a folder. Originals stay in place; keep those folders and external drives available.
2. Load a song with **A** or **B**, then press **Play**. A playing deck cannot be replaced. Deck volume, seek, remaining time, crossfader and master volume are always visible.
3. Use **+** to queue songs; arrows reorder individual queue entries. Repeated songs are supported. Create a playlist, switch to All music, and use **+ List** to add songs to it. Queue an entire playlist or remove its references without deleting files.
4. **Manual**: load and control both decks yourself. **Assisted**: the next queued song is prepared on the idle deck; **Next** starts it. **Auto DJ**: first start a deck or press Next; subsequent songs transition automatically. Switching to Auto DJ never starts an idle application by itself.
5. Set crossfade to **0–15 seconds**. Fades are limited to the outgoing time remaining and half the incoming song length. A zero fade cuts between songs. Crossfader movement cancels a running transition and selects Manual mode; pausing during a transition also returns to Manual mode. A/B transition buttons play the loaded incoming deck and fade to it.
6. Add local clips to the **Soundboard**. Button settings edit labels, colors and single-character shortcuts. Effects mix with music and have their own volume. Retriggering a pad restarts its sound; different pads can overlap (up to 12 simultaneous effects). Stop a single effect, click Stop all, or press Escape while focus is outside a form/control.
7. Optional guest requests appear in the bottom-right panel. Approve, reject, prioritize or mark played. **Find local music** appears for approved requests; it searches the library. Add a matching local song to the queue yourself. No audio is downloaded and no request enters playback automatically.

The master includes a fast dynamics compressor, plus an output peak meter. It reduces clipping risk; it is **not** a verified brick-wall limiter or loudness normalizer. Leave headroom, especially with sound effects and similar/correlated tracks. There is no beatmatching, BPM analysis, musical phrase detection, separate headphone cue output, or streaming-service integration.

## Audio formats and files

The importer recognizes MP3, WAV, OGG, FLAC, M4A, AAC, AIFF, OPUS and WMA extensions. Actual playback depends on Electron/Chromium's decoder and the file's codec. WAV/PCM is the baseline for tests. A recognized extension or readable metadata does not guarantee decoding. Unsupported, corrupt or missing songs generate an error. Auto DJ skips failed queue entries with a visible diagnostic and continues to a playable entry; it checks at most 20 failures per preparation pass. An empty queue lets the current song finish. Loading early and scheduling gain curves on the audio clock reduces transition gaps, but a slow/disconnected drive or decoder failure can still cause silence; test your real files.

No operation modifies or deletes source audio. File paths and metadata are saved; audio is not copied into the application. Each folder-import batch is limited to 20,000 files. Metadata parsing happens in Electron, not in the audio renderer.

## Saved state and diagnostics

Library, queue, playlists, pads, playback mode, fade time, effects/master volumes and guest URL save automatically. Deck playback positions are deliberately not restored and playback never resumes on startup. Settings live in Electron's user-data directory (normally `%APPDATA%/wedding-dj-console`). `state.json` is replaced through a flushed temporary file; `state.json.bak` holds the previous validated state. Corrupt files are copied to `state.json.corrupt-*` before replacing them. If loading fails, the UI shows a recovery warning. Back up this directory and your original music before the wedding.

`diagnostics.log` records startup, playback, import, network and save errors; it rotates near 2 MB. Save failures remain visible. Closing while audio is playing requires confirmation. A power-save blocker requests that Windows not suspend the app during playback; it cannot override lid-close policy, OS updates or device removal.

For an isolated rehearsal profile, create a folder and set `WEDDING_DJ_DATA_DIR` to its absolute path before launching. The automated audio smoke test uses a temporary profile and preserves it for inspection.

## Optional Firebase setup

Local music and soundboard functionality require no Firebase credentials, account or internet. Follow [docs/FIREBASE.md](docs/FIREBASE.md) to connect requests, deploy the guest website and configure QR sharing. Copy `.env.example` to `.env.local` only if you want this integration. Firebase client config is public configuration; never put service-account keys, administrator secrets or passwords in a `VITE_*` variable.

Before publishing changes, run `npm run check:secrets`. This checkout has a pre-commit secret scan; use `npm run security:install-hook` to enable it in a new clone. See [safe publishing](docs/PUBLISHING.md) for exclusions, scan coverage and handling an exposed credential.

## Verification

```powershell
npm run typecheck
npm test
npm run test:firebase
npm run build
npm run test:audio
```

The audio smoke test plays quiet synthetic WAV tones through **real Electron media elements and Web Audio**, verifies an advancing playback clock and nonzero post-mixer signal, exercises imports/queue/Auto DJ/failures/effects, restarts the app, and checks that original fixture hashes did not change. It writes screenshots and a result record to `test-results/`. This is automated signal verification, **not a human listening test**.

`npm run test:firebase` requires Java 21+ and runs 29 Firestore rules and direct-client integration tests with Auth/Firestore emulators in the isolated `demo-wedding-dj` project. It verifies limits, concurrent requests/votes, DJ permissions and two-client real-time updates, then stops the emulators. `npm run test:rules` runs the 28 rules/transaction tests without Auth. No Cloud Functions, Firebase login or production credentials are needed. The launcher finds the default Temurin 21 installation on Windows. See [Firebase testing details](docs/FIREBASE.md#local-emulator-tests).

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the current evidence and the remaining event rehearsal checklist. This project must not be considered production-ready until actual listening, live guest integration and a long session on the target reception equipment have passed.

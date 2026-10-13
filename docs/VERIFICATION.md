# Verification and reception rehearsal

The implementation includes all four phases. Test evidence is recorded below; **production readiness has not been established**.

## Evidence

| Area | Evidence | Remaining verification |
|---|---|---|
| Queue / transitions | Automated unit tests pass: identity-based reorder/removal, equal-power curves, short tracks, zero fades, reservations, start failures, playing-deck protection | Real song pacing and transitions on reception hardware |
| Persistence | Automated disk tests: restart data, overlapping writes, corrupt state backup recovery, invalid schema | Backups, disk-full/permissions on target laptop |
| Actual local audio | Real Electron smoke test passed: WAV decoder, media clock, nonzero post-mixer signal, volume, network disabled, Auto DJ, corrupt-file skip and restart; see `test-results/audio-smoke.json` | Human listening and speaker/device checks; other codecs; long session |
| Soundboard | Actual signal smoke test plus stop-all cleanup | Listen for clicks, check every clip and keyboard shortcut |
| Guest validation | 29 Auth/Firestore emulator tests pass for direct client writes, limits, concurrency, duplicates, privacy and moderation | Actual phones, reception network and usage limits |
| Firestore rules | Rules deployed to wedding-dj-console-2026; live submission and voting succeed; guest moderation is denied | Ongoing usage monitoring; anonymous identities can be reset |
| App Check | Optional SDK configuration only; not enforced in the current deployment | A tested strategy covering both guests and Electron before enforcement |
| Hosted guest site | Live anonymous submission, second-client vote, repeat rejection, listener updates and DJ approval/priority/played/rejection verified; browser form submission also passed | Printed QR scan and actual phones |
| Windows distribution | Version 0.2.0 NSIS installer and portable executable built with live Firebase configuration; automated audio smoke evidence concerns the earlier 0.1.0 package | New package rehearsal, installer run on a clean Windows laptop; unsigned-binary acceptance |

The current implementation passes **55 automated tests**: 26 desktop unit/disk/streaming tests and 29 direct Firestore/Auth tests. TypeScript checks and desktop/guest builds pass. Live backend verification is separately recorded in `test-results/firebase-live.json`. Cloud Functions are inactive and undeployed. Billing is disabled with no linked account; the guest integration uses the free Spark plan. The latest wedding date is October 24, 2026. Earlier automated audio evidence uses quiet generated WAVs and does not represent a person listening. Runtime dependency audit previously reported zero advisories; development-tool advisories still need review before publishing releases.

Run `npm run test:firebase` for all 29 local Firebase tests, or `npm run test:rules` for 28 rules/transaction tests without the Auth emulator. Results are stored in `test-results/firestore-rules.json`. The production smoke test uses actual Firebase anonymous sessions and DJ credentials; its clearly labeled fixture ends rejected. Java is needed for emulator tests only, not desktop playback. Old Functions/App Check test reports concern the inactive architecture and do not validate the current deployment.

## Manual listening gate (must be done by a person)

- Use the actual reception laptop, audio adapter, mixer and speakers. Check Windows output selection before launching. Start at a low master volume.
- Listen to every music format you will use. Scrub near the end, pause/resume, check titles and durations, and confirm originals remain unchanged.
- Listen to 0s, 2s, 6s and 15s transitions. Try a short song, repeated queued tracks, reordered/removed prepared entries, and an empty queue. Verify both decks, crossfader endpoints and deck/master volume behavior.
- Test effects over music, overlap several effects, stop one, stop all, and use shortcuts. Keep headroom; the compressor is not a verified brick-wall limiter.
- Disconnect Wi-Fi during playback, close/reopen the app, unplug a nonplaying music drive, try a corrupt/unsupported file, and verify understandable error messages.
- Rehearse for at least the expected reception duration. Check CPU/memory, audio glitches, accidental sleep/lid-close behavior, and that the saved queue is correct after restart.
- Test live guest requests on two phones and DJ moderation. Scan the actual printed QR from different devices.
- Keep a second independent playback device with essential reception songs available. Have a written recovery sequence: stop effects, lower master, confirm output device, inspect diagnostic message, load a known-good song, restart only if necessary.

## Event day

Freeze a verified build and your music folders before October 24. Connect power, disable scheduled restarts during the reception, check speaker cables/output, back up the profile and queue, and perform a brief sound check. Keep guest-network troubleshooting separate from operating the local decks.

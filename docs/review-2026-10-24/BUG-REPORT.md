# Neo / NeoCraft code review and bug report

Reviewed 2026-10-24. Repository: iannitram/neo. Baseline: `3f21d090662cbcbd441d5207292e2c175ee1a01a` (main), package version 1.6.0.

## Assessment

Do not make this build the default Nextcloud editor yet. It is a capable local book editor with thoughtful recovery mechanisms, but the fork identity is still upstream's and several persistence paths can discard another device's changes. Document mode and the Nextcloud app described in the existing roadmap are planned, not implemented.

This is a repository-wide architecture and source review, with deeper tracing of persistence, sync, snapshot retention, import/export, process boundaries, mobile bridges, and release configuration. It is not a certification that every editor interaction is bug-free. No production data was modified. Findings below distinguish executed reproductions from source-traced failures. Severity: P1 = possible loss of writing or wrong application update; P2 = reliability failure. None is asserted to be a remotely exploitable vulnerability.

## B01 — P1: fork builds retain upstream identity and update feed

**Evidence:** `package.json:3`, `:36`, `:40`, `:65`; `main.js:43`, `:3200`; `.github/workflows/build.yml:103` onward.

Build/package the fork and install beside NEO. Product name, application ID, default library, update publishing configuration, and the fallback release query still identify Hugh's NEO. The packaged updater enables automatic download and install on quit (`main.js:3158`). A fork build can therefore follow upstream releases and lose fork functionality; coexistence also shares identity/library assumptions. macOS CI still imports upstream-style signing secrets and requests notarization, despite the fork roadmap choosing unsigned builds. Missing credentials can block that build; credential availability was not inspected.

**Expected:** independent NeoCraft installation, settings/library defaults and updates from iannitram/neo.

**Fix:** implement M0 completely, including manual release URLs, native mobile identifiers if those are distributed, CI smoke-test paths, and clean-machine coexistence tests. Renaming only `build.publish` is insufficient. **Validation:** source-confirmed configuration mismatch; installers/updater not executed.

## B02 — P1: chapter conflict detector ignores formatting, order and deletions

**Evidence:** `main.js:828`, `:845`; `pocket/www/pocket-bridge.js:163`, `:347`.

The guard compares word multisets and rejects a stale save only if the disk has a word the proposed text lacks. Example: base `<p>red blue</p>`, remote `<p><b>blue</b> red</p>`, local `<p>red blue green</p>`. A stale local save returns success and replaces the remote formatting/order without retaining a twin. Remote deletion can likewise be restored unintentionally when the local version contains all surviving words.

**Expected:** any unexpected content revision triggers preservation/merge, including formatting and ordering changes.

**Fix:** compare exact known content/revision (current equals expected or already equals proposed); preserve divergent content before replacing it. For Nextcloud use server-enforced ETags rather than porting this heuristic. **Validation:** reproduced using the actual main-process handlers in `docs/review-2026-10-24/review-repro.cjs`.

## B03 — P1: stale metadata save can hide another device's new chapter

**Evidence:** `main.js:789`; `app.js:886`, `:12367`, `:13032`.

Open the same book on two devices. Device A adds c2 and saves `chapterOrder: [c1,c2]`; device B, before its next refresh, renames the book or saves its position using old metadata `[c1]`. `book:writeMeta` replaces all metadata unconditionally. The next read omits c2. Its HTML file survives but becomes orphaned from the book's order. The refresh merger cannot recover remote structure once the overwritten metadata is gone; `.bak` is only a rolling copy.

**Expected:** stale metadata must not erase remote chapter references or notes stored in metadata.

**Fix:** add a metadata revision/base, merge independent fields, and preserve conflicting structural revisions. Apply equivalent handling to library.json (which also writes unconditionally), including shelves and author settings. **Validation:** actual handler reproduction confirms c2 remains on disk but disappears from chapterOrder. Library implications are source-traced, not a separate executed scenario.

## B04 — P1: notes and outline HTML have no cross-device conflict preservation

**Evidence:** `main.js:865`, `:872`; `app.js:11847`, `:13032`.

Both devices edit the same notes page. `flushAux` sends only the replacement HTML; `aux:write` has neither an expected revision nor a backup. Refresh reads chapters, metadata, stickies and darlings, but not auxiliary HTML. The later save replaces earlier notes. Atomic rename protects against partial writes, not stale overwrites.

**Fix:** give auxiliary pages the same revision/preserve-both contract as chapters, refresh them when clean, and retain the displaced text when dirty. **Validation:** actual handlers reproduce replacement with no notes.html.bak. End-to-end two-device UI timing was not run.

## B05 — P1: bound-shelf page sheet treats a failed save as saved

**Evidence:** `app.js:1626`, particularly `:1652`–`:1662`.

Edit a page in `openPageSheet`, then make the write fail (disk full/permission denied). The save closure updates `saved` before awaiting `writeChapter`. Retrying Done without further typing finds identical HTML and returns early; the sheet can close with the edit unwritten. This path also calls writeChapter without `expected`, bypassing chapter conflict protection.

**Fix:** advance the saved baseline only after successful acknowledgement, keep the sheet open on failure with recovery text, serialize pending writes, and pass the known revision. **Validation:** the actual extracted save closure was run with a rejecting bridge; two calls made only one write attempt. No GUI execution.

## B06 — P1: snapshot thinning can replace unavailable history with empty text

**Evidence:** `app.js:12603`–`:12617`; `main.js:903`–`:907`; Pocket `snapshotRead` in `pocket/www/pocket-bridge.js`.

When thinning an old automatic snapshot, the code reads a chapter, copies it forward, then removes the old snapshot. A failed read or an iCloud file that does not arrive returns `''`. The thinning code accepts that as content, writes an empty chapter into the next snapshot, and removes the source snapshot. A future restore can consequently lose historical text even though the live manuscript remains intact. Snapshot writes returning `false` are also not checked before deletion.

**Fix:** distinguish unreadable from legitimately empty content; abort thinning on any failed read/write, verify copied files against expected hashes, and delete the source only after complete verified transfer. Test cloud timeout, ENOENT/EACCES, destination already present, interruption and retry. **Validation:** source-traced failure path, not exercised against real iCloud. Prioritize an injected-failure regression before retention runs in production.

## B07 — P1: Pocket silently falls back from atomic replacement to direct overwrite

**Evidence:** `pocket/www/pocket-bridge.js:79`–`:100`.

If rename fails for any reason, `writeText` writes directly over the existing destination. The temporary copy is not enough to make that overwrite atomic. App termination/storage failure during the fallback can truncate a chapter; ordinary chapter reads do not recover the temporary HTML. This contradicts the stated whole-file save guarantee.

**Fix:** classify rename errors; use a native replace/coordination operation for each supported storage backend. If atomic replacement cannot be achieved, retain old and new versions and report a retryable failure rather than overwrite the only good destination. Test rename denial and termination during write on Android and iOS. **Validation:** source-confirmed fallback; native interruption not executed.

## B08 — P2: exit has no awaited save completion protocol

**Evidence:** `app.js:12379`, `:13273`; `main.js:2225`, `:3372`.

`beforeunload` invokes `flushAllSaves`, which returns no promise and queues asynchronous chapter/auxiliary writes. The main window's close listener only remembers geometry. Closing while a save is queued does not establish that IPC was delivered or that writes completed before the renderer/application exited. The Promise-based Pocket bridge makes this especially relevant during background termination. Exact loss timing is platform-dependent; this is a lifecycle reliability defect, not a claim that every close loses text.

**Fix:** expose a flush barrier covering all pending writes; desktop prevents close until acknowledged, with explicit recovery on failure. Browser/mobile must persist recovery drafts during editing/background transitions; unload cannot guarantee a network save. **Validation:** source-traced; real Electron close timing not executed.

## Additional review observations and migration blockers

- **CI:** neither workflow runs the unit suite or lint on PR/push. Release packaging and a Windows boot test cannot protect complex editor logic. Add PR CI before refactoring; use locked installs. This is a coverage gap, not evidence all existing tests are ineffective.
- **Untrusted document boundary:** chapter and darling HTML are inserted into live DOM (`app.js:2682`, `:11923`). Desktop CSP limits scripts, but this is not a safe same-origin Nextcloud document renderer. Introduce a schema/allowlist sanitizer and disallow active content, remote resources and dangerous links before the web app ships. No working XSS exploit was demonstrated.
- **Formats:** existing import creates books and is intentionally lossy; DOCX is read with regex (`main.js:1845`), Markdown is paragraphized, and text decoding falls back to Windows-1252 (`:1830`). No RTF parser, source-preserving Markdown model or in-place Document mode exists. These are missing planned capabilities, not bugs against the current book-import contract.
- **Secrets:** `secret:set` writes plaintext if safeStorage reports unavailable (`main.js:1058`). Do not reuse that fallback for Nextcloud app passwords without an explicit credential policy. `readSecret` also returns encrypted base64 as though it were a key when encryption becomes unavailable. Keep credentials out of synced libraries and logs.
- **Backups:** the worker bounds read waits and reports skipped files, but archives are not a transactionally consistent snapshot of a concurrently edited library. It follows filesystem symlinks via stat and buffers files/archive in memory. Bound traversal/resources before exposing any server-side archive operation.
- **Native PDF:** Android disables JS; iOS uses WKWebView and an arbitrary 600ms font delay. Add large-document/font readiness and overlapping-job tests if mobile exports are included in releases.
- **Strengths to retain:** isolated Electron renderer, explicit bridge, durable desktop replace/fsync, retryable chapter saves, preserved conflict twins, device-specific presentation settings, worker spellcheck and backup separation, plain-file books and substantial editor regression tests.

## Verification and limitations

Executed `npm test` on Node 24.19.0: **27 test files passed, 3 failed** (30 file-level results, not 30 individual assertions). Remaining failures are environment/snapshot limitations: iCloud tests use child processes/mkfifo blocked by the sandbox; spellcheck requires uninstalled Hunspell/dictionary packages; window-icon expects the binary build/icon.png omitted from the text snapshot. They are not reported here as product regressions. Initial missing print patterns and screenplay fixtures were retrieved and those tests then passed. Direct `node scripts/filesystem.test.js` passed 6 subtests; direct print tests passed 7; screenplay tests passed 15. Four targeted reproductions passed (meaning the reported defects occurred).

The shell proxy could not clone the repository, so GitHub's connector supplied a pinned text source snapshot, including source, tests, locales and print JS. It is not a full Git checkout or a distributable build: fonts, images, binary dictionaries and installed dependencies are absent. No npm install/build, lint, dependency vulnerability audit, Electron GUI, native mobile build, real Nextcloud instance or real two-device integration test was completed. Nextcloud version/package counts in the prior roadmap are planning inputs, not independently verified server inventory.

Run the supplied diagnostic from the snapshot root with `node docs/review-2026-10-24/review-repro.cjs`. It uses temporary libraries and removes them. Preserve the baseline SHA when turning these entries into issues. Recommended order: B01, B05, B06, then B02–B04/B07/B08 with regression tests and a shared persistence contract.

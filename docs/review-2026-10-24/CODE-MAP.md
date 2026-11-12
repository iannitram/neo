# Neo / NeoCraft code map

Describes commit: `c1c2d9f` (2026-11-12). Line numbers below were moved forward from the 2026-11-02 check (`44c3118`) by the diff between the two commits, then spot-checked against `main.js` and `app.js` on `c1c2d9f`; the generated SYMBOL-INDEX.md and the bug report still carry the older baseline (`3f21d09`, 2026-10-24), so their line numbers sit about 4 to 60 lines earlier. Proposed Nextcloud modules are in NEXTCLOUD-PLAN.md; the small pure ones, the document-session core and the desktop document host have landed (see "NeoCraft modules on main") along with the empty `neocraft` app scaffold; the Document-mode view, the `txt` and `markdown` adapters, `hosts/nextcloud.js` and the PHP features do not exist yet.

**Who owns what.** Upstream (hughhowey/neo) owns the editor, the library and book code, the exporters, Pocket and the build scripts: `app.js`, `main.js`, `preload.js`, `index.html`, `styles.css`, `manuscript.js`, `covers.js`, `art.js`, `i18n.js`, `locales/`, `spell-*.js`, `backup-worker.js`, `print/`, `pocket/`, `dictionaries/`, `fonts/`, `scripts/` (upstream's tests and tools) and the other files in the first tables below; it is merged into `main` monthly. Our fork adds new files (the modules listed under "NeoCraft modules on main" and "Planned 1.0 modules", with their `scripts/*.test.js`), small `// NEOCRAFT:` hooks in `main.js`, and the identity, build and pipeline files (`package.json` build block, `.github/workflows/`, `PIPELINE.md`, `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md`, `AGENTS.fork.md`, this folder).

## Runtime and data flow

```mermaid
flowchart LR
  UI["index.html + app.js + styles.css"] --> BR["preload.js: window.neo"]
  BR --> MAIN["main.js: IPC / filesystem / menus"]
  MAIN --> LIB["NeoCraft Library: JSON + chapter HTML"]
  MAIN --> SPELL["spell-worker.js: Hunspell WASM"]
  MAIN --> BACK["backup-worker.js: ZIP + retention"]
  MAIN --> PRINT["offscreen Chromium + Paged.js"]
  MAIN --> ART["art.js: optional OpenAI cover generation"]
  MOBILE["Pocket WebView + shared editor"] --> PB["pocket-bridge.js: window.neo"]
  PB --> CAP["Capacitor filesystem + native plugins"]
  CAP --> PHONE["phone library / iCloud"]
```

Desktop uses contextIsolation and disables nodeIntegration. Browser-facing methods are in preload.js; storage work belongs in main.js. Pocket implements a second host API while copying the same editor code at build time. UI behavior is mostly a single 18,856-line file; main.js is 3,942 lines. Small independent modules already exist for covers, localization, spelling normalization and manuscript export, and the fork's pure modules (merge, flush barrier, formats, conflict copy, handoff, excluded folders, atomic write, Nextcloud client config, open arguments, Tailscale origin rules, the document-session core) sit beside them; only `meta-merge.js`, `flush-barrier.js` and, in `main.js`, `hosts/electron-document.js` (with `desktop/atomic-write.js` and `desktop/open-args.js` through it) are called from the app so far.

## Entry points and major files

| File | Responsibility / useful starting point |
|---|---|
| `package.json` | Electron entrypoint, scripts, dependency/build configuration, product identity and updater publishing |
| `index.html` | Desktop DOM, CSP, scripts, shelf/editor/auxiliary panes; tightly coupled to app.js selectors |
| `preload.js` | Complete desktop `window.neo` API, IPC invoke/send/event mapping; synchronous initial locale/paper data |
| `main.js:17` | IPC error wrapper; logs and reports failures without changing handler timing |
| `main.js:49` | Library root selection, settings, language and writable-folder fallback |
| `main.js:670` | libName/bookDir boundaries; one-segment names, not symlink containment |
| `main.js:684` | Human-readable catalog regeneration |
| `main.js:735` | Rename retry, durable replace, fsync, JSON spare recovery |
| `main.js:778` | iCloud placeholder detection/download/wait; rebuild metadata at :904 |
| `main.js:944` | Library, book, chapter, auxiliary, snapshot, sidecar and cover IPC handlers |
| `main.js:1429` | Secret storage; cover painting starts at :1464 |
| `main.js:1561` | PDF window; ZIP export at :1653, export IPC at :1668 |
| `main.js:1709` | KDP geometry/hyphenation, Paged.js layout, exact page boxes and cover templates |
| `main.js:2083` | DOCX style/run importer; text decoder :2216; importFile :2231 |
| `main.js:2483` | Delayed backup utility-process orchestration |
| `main.js:2541` | Window setup; spelling request orchestration :2687; menus later in file |
| `main.js:3653` | Update lifecycle and fallback release queries; final section starts app/window lifecycle |
| `manuscript.js` | Pure model-to-DOCX parts / HTML export, font/paper/word-count/header rules; shared Node/browser module |
| `covers.js` | Seeded canvas cover rendering and title typography in renderer |
| `art.js` | Manuscript excerpt → brief → painted image, optional external API calls |
| `i18n.js`, `locales/` | Translation interpolation and regional fallback; English phrases are keys |
| `spell-worker.js`, `spell-ro.js` | Serialized Hunspell load/check/suggest/add and Romanian normalization |
| `backup-worker.js` | Bounded read waits, cloud exclusions, in-memory ZIP, durable output and retention |
| `styles.css` | Shared presentation tokens, book/editor/outline/print/accessibility styling |
| `print/` | Vendored Paged.js and TeX hyphenation engine/patterns; external code, not independently audited here |

## app.js navigation by section

| Line on main | Feature and main concerns |
|---|---|
| 190 | Global library/book state, saved baselines, pending writes and device look |
| 777 | Bookshelf rendering, author/shelf/book operations |
| 1279 | Bound shelves, special pages and page sheets (separate save path) |
| 2609 | Open book and render chapters; hydrate chapter and sidecar state |
| 2968 | Typing, selection, paragraph transformations, normalization and paste |
| 4045 | Poetry/flush paragraph behavior; keyboard and style helpers follow |
| 5252 | Optional Vim-style movement |
| 5689 | Screenplay model, scenes, line classes, pagination and Fountain/FDX conversion |
| 7366 | Footnotes embedded in chapter HTML |
| 7595 | Placeholders/stickies and navigation |
| 7813 | Navigation pane and chapter operations |
| 8250 | Per-book and per-chapter notes pages |
| 8611 | Manuscript/Notes/Outline/Darlings tabs and editor swapping |
| 8957 | Structured outline and chapter/section relationships |
| 9384 | Outline cards, moving held writing, loose cards and scene/chapter manipulation |
| 12256 | Word, page and daily counters, goals integration |
| 12500 | Saving: diskKnown, chapterChain, persistChapter, metaSig, flushAllSaves |
| 12833 | Differential snapshots, manifests, retention and restore UI |
| 13460 | refreshFromDisk: chapter stamps, metadata/sidecar reconciliation, conflict twins |
| 13778 | Structural undo/redo, preservation of writing changed since snapshots |
| 14113 | Native speech synthesis read-aloud |
| 14298 | Find/replace and non-persisted CSS highlights |
| 14594 | Import-to-book UI and conversion |
| 14755 | Spellcheck pass, suggestions and typewriter scrolling |
| 15286 | Focus mode |
| 15458 | Goals/sprints/charts, then cover-art settings at 15512 |
| 15703 | Help, fonts and menu message handling |
| 16108 | Export/email entrypoints; manuscript format at 16233 |
| 16439 | Paperback/KDP and other export-building helpers |
| 18523 | Error reporting; Linux font handling, accessibility at 18585 |
| 18769 | Simple NEO feature gating and settings migration |

## Persistence model and ownership

```
NeoCraft Library/
 library.json               authors, shelves, custom words, shared preferences
 _catalog.txt               regenerated folder/title map
 neo-errors.log
 Backups/neo-backup-*.zip    daily worker archive; snapshots excluded
 Exports/                   emailed snapshots
 book-<slug>-<id>/
  book.json                 chapterOrder, titles/kinds, notes/cards, position, counts
  chapters/<id>.html        manuscript, persisted semantic classes/attributes
  notes.html / outline.html
  notes-<chapter>.html      per-chapter notes
  darlings.json / stickies.json
  cover-* / art-* / art.json
  snapshots/<stamp-kind-...>/
   snapshot.json            order/titles/kinds + hashes and changed chapter set
   <chapter>.html           changed chapter content, inherited from prior snapshots
```

Desktop settings/secrets live in Electron userData, outside the library. Appearance also lives per device in localStorage. Core renderer state uses `chapterHTML` for current edits, `savedHTML` for the scheduled/saved baseline, and `diskKnown` for acknowledged/read content. `persistChapter` serializes per chapter and preserves rejected disk versions as twin chapters. `refreshFromDisk` polls stamps and reconciles metadata/chapter changes; auxiliary notes have a different pending-write path. These differences explain several review findings.

Snapshots hold chapter history and chapter shape, not a complete backup of every sidecar/setting. Backups omit snapshots. Structural undo is an in-memory action history; it is not the same as either persistence mechanism. Keep these three recovery contracts distinct during refactoring.

## Mobile host

| Area | Role |
|---|---|
| `scripts/pocket-www.js` | Copies shared UI/assets/locales; rewrites Hunspell browser import; collects dictionaries from main.js list |
| `pocket/www/index.html` | Mobile DOM, mobile menu and keyboard UI; loads shared editor/bridge |
| `pocket/www/pocket-bridge.js` | Filesystem host, iCloud locator, mobile export/share, spell engine, keyboard and back handling |
| `pocket/www/pocket-spell.js` | Browser worker/direct module implementation of spelling messages |
| `pocket/www/pocket.css` | Mobile layout/keyboard adaptations |
| `pocket/ios/App/App/LibraryHome.swift` | iCloud/local library selection, fetch and keyboard helpers |
| `pocket/ios/App/App/NeoPdf.swift` | WKWebView → native PDF and sharing URI |
| `pocket/ios/App/App/{AppDelegate,SceneDelegate}.swift` | App/scene lifecycle and Capacitor wiring |
| `pocket/android/.../MainActivity.java` | Capacitor lifecycle, keyboard/back behavior and plugin registration |
| `pocket/android/.../NeoBarsPlugin.java` | Android system bar appearance and hardware keyboard information |
| `pocket/android/.../NeoPdfPlugin.java` | WebView/native print manager export |
| `pocket/capacitor.config.json`, native manifests/build files | Platform identifiers, entitlements, permissions and distribution |

## Verification and release tooling

`npm test` runs `scripts/*.test.js` (89 files on main) with node:test, mostly using VM-extracted functions or mocked Electron plus real temporary files. Suites cover filesystem/durability/cloud behavior, sync/daily counts, typing/paste, screenplay/import, spelling, snapshots, formatting, manuscript and print rules, the page-sheet save path (`page-sheet-save.test.js`) and the fork's pure modules (one `*.test.js` per module in "NeoCraft modules on main", for example `meta-merge.test.js`, `flush-barrier.test.js`, `dav-save.test.js`, `docx-scan.test.js`, `rtf-scan.test.js`, `atomic-write.test.js`), the close-time save tests (`close-*.test.js`), `recovery-drafts.test.js` and `code-map-translation-keys.test.js`. Several of the fork's tests are locked tests added with their issues; do not edit them to make a build pass. `npm run lint` runs oxlint with `.oxlintrc.json` (`print/` ignored). `*.e2e.js` (`npm run test:words`, `test:tabs`, `test:notes` and the like) are separate Electron-driven integration scripts and are not part of npm test. They need a working Electron environment/assets, and each now builds its temporary library as `NeoCraft Library` to match the fork's library folder name (`DEFAULT_LIBRARY_NAME` in `main.js`). `scripts/fixtures/` holds the Fountain/FDX samples the screenplay tests read. Read the bug report for actual run results and restrictions.

`.github/workflows/build.yml` ("Build NeoCraft") builds desktop on version tags/manual dispatch, checks tag/package agreement, smoke-tests the Windows build (it looks for a `NeoCraft` process and `NeoCraft Library/library.json`) and attaches draft release artifacts: Windows NSIS + portable x64, macOS dmg + zip for arm64 and x64 (unsigned: `identity: null`, no notarization, no signing secrets), Linux AppImage for x64 and arm64 (the `linux` build block in `package.json` lists the `AppImage` target with `arch: [x64, arm64]`, and the `linux` job runs `electron-builder --linux` with no `--x64` or `--arm64` flag, so both are built and `dist/*.AppImage` attaches both; checked 2026-11-12. ROADMAP M0 and SPEC M2 still say "AppImage x64") `pocket.yml` builds native Pocket; its release notes now point bug reports at the fork. Neither is PR unit/lint CI: `.github/workflows/ci.yml` ("CI") is, on every pull request and push to main: `npm test` on Ubuntu, macOS and Windows, plus a lint job (`npm run lint:ci`, which fails only on errors added beyond `scripts/lint-baseline.txt`, checked by `scripts/lint-new-errors.js`); the `*.e2e.js` scripts stay out of it. `scripts/release.js`, `bundle.js` and `try.js` are upstream maintainer delivery tools; do not invoke them as part of reviewing or generating documents because they can push/release. `scripts/i18n.js` refreshes/checks string catalogs. This review adds only documentation plus a temporary-library diagnostic script in this folder, not production behavior.

## Change routing

- Save/conflict/recovery changes: app saving/refresh + main filesystem handlers + Pocket host, with injected-failure tests.
- Book formatting: app typing/captureBody + CSS + export serializers; verify that transient UI marks never enter chapter HTML.
- New host capability: explicit API and capability contract, adapter, call site and parity test. Document mode should use a smaller dedicated interface.
- Nextcloud conversion: new document core/formats/host/app modules; keep books on their existing API while fixing reviewed defects. Do not expose the Electron bridge directly to a web page.
- Visible text: a string passed to `t('...')` (also `tk(`, `NeoI18n.t(` and the `data-i18n*` attributes in `index.html`) is the lookup key into every `locales/*.json` file, so editing it in code without changing the key and each translated value there silently drops every language back to English. Change the key and every locale's value together, then run `node scripts/i18n.js check <code>` for each language.

## NeoCraft modules on main

Pure, dependency-free modules the fork has merged so far (2026-10-27 to 2026-11-12). Each is a classic script that sets a browser global and also `module.exports` in Node; each has a locked test in `scripts/`. **Only `meta-merge.js` (`reviseBookMeta`), `flush-barrier.js` and, in `main.js`, `hosts/electron-document.js` (which calls `desktop/atomic-write.js` and `desktop/open-args.js`) are called from the app so far**; every other row below is not called from `app.js`, `main.js`, `preload.js`, `index.html` or Pocket yet, and the issues that wire them in are the "Planned 1.0 modules" rows below.

| Path | Status | Owns | Used by (or planned use) | Issue / test |
|---|---|---|---|---|
| `meta-merge.js` | present | `mergeOrder(base, local, remote)` (chapter order; a local addition anchors on its nearest preceding id), `mergeBookMeta` (book.json fields; `chapterOrder`, `modified` and `revision` are resolved, not conflicts), `mergeLibrary` (library.json: authors, shelves, custom words, preferences) | wired: `reviseBookMeta` is called from `book:writeMeta` in `main.js` (:1121) and from Pocket's `pocket-bridge.js` (`pocket/www/index.html` loads the script; `scripts/pocket-www.js` copies it). Planned: `mergeBookMeta`/`mergeOrder` (#39) and `mergeLibrary` in `library:write` (#40) | #37, #38; `meta-merge.test.js`, `meta-merge-library.test.js` |
| `flush-barrier.js` | present | `createFlushBarrier({ setTimer, clearTimer })`: `track(promise, label)`, `pending()`, `flush(timeoutMs)`; reports late and early rejections and times out late writes | wired: `index.html` loads it and `app.js` `settleSaves` builds a barrier (:12795). Planned: desktop close/quit waiting for acknowledged saves (#43), recovery drafts (#44) | #42; `flush-barrier.test.js` |
| `formats/markdown-frontmatter.js` | present | `splitFrontmatter(text)` / `joinFrontmatter(parts)`: BOM, frontmatter and body held apart, byte-exact | `formats/markdown.js` (#49) | #46; `markdown-frontmatter.test.js` |
| `formats/wikilinks.js` | present | `findWikilinks(text)`: `[[links]]` with exact source spans, skipping code | `formats/markdown.js` (#49) | #48; `wikilinks.test.js` |
| `hosts/conflict-copy.js` | present | `conflictCopyName(fileName, date, attempt)` and `createExclusive({ fetch, folderUrl, fileName, bytes, date, requestToken })`, which PUTs a conflict copy with If-None-Match so it never overwrites | `hosts/nextcloud.js` (#58), `hosts/electron-document.js` | #57; `conflict-copy.test.js` |
| `desktop/handoff.js` | present | `createIntent` and `createIntentVerifier`: single-use, expiring `neocraft://` handoff intents | Launch external (#77) | #75; `handoff.test.js` |
| `nextcloud/neocraft/src/excluded.js` | present | `normalizePath`, `isExcludedPath(path, excluded)`: excluded-folder matching for the Nextcloud app | the PHP app's file actions and "+ New" (#66, #67) | #64; `excluded.test.js` |
| `document-session/serial.js` | present | `createSaveSerializer(saveFn)`: saves run one at a time, the newest waiting request replaces an older pending one, a failed save does not block later ones; `createRequestGuard()`: increasing tokens so a late reply after navigation is ignored | `document-session.js` (#18) | #32; `session-serial.test.js` |
| `document-session/drafts.js` | present | `createDrafts({ store, now, retentionMs })`: one recovery draft per account and file (`write`, `clear` on a confirmed save by generation, `discard`, `findDraft`, `offerDraft`, `clearAccount` on logout, `prune`); typed `DraftError` (`quota`, `storage`); 30-day default retention; `createIndexedDbStore(indexedDB)` over the injected store contract | `document-session.js` through its optional `recovery` option (edit writes, confirmed save clears; failures go to `onError`). Not yet called from `app.js` or Pocket | #35; `document-drafts.test.js` (IndexedDB is faked; not exercised in a browser) |
| `formats/span-patch.js` | present | `applySpanEdits(source, edits)`: edits as replacements of exact source ranges, so every byte outside an edit stays identical; overlap and out-of-range throw | `formats/markdown.js` (#49), `formats/txt.js` | #47; `span-patch.test.js` |
| `formats/minimal.js` | present | `minimalMarkdown()` (empty bytes) and `minimalDocxParts()` (the smallest valid .docx parts) for the "+ New" menu | the PHP app's "+ New" (#67) and the desktop host | #65; `minimal.test.js` |
| `formats/docx/limits.js` | present | `checkPackageLimits(entries, limits)` (entry count, sizes, ratio, bad names) and `xmlIsSafe(xml)` (entity check); `DEFAULT_LIMITS` | the `.docx` reader (`formats/docx/read.js`, #53) | #51; `docx-limits.test.js` |
| `formats/docx/scan.js` | present | `scanDocx(...)`: lists the Word features NEO's simple model cannot keep (tables, images, comments, tracked changes, fields and so on) from `document.xml`, relationships and part names; browser global `NeoCraft_DocxFidelity` | the session's fidelity report and fallback (#55) | #52; `docx-scan.test.js` |
| `formats/docx/read.js` + `package.js`, `xml.js` | present | `readDocx(bytes, name, { limits }?)` → `{ model, meta }`: bounded JSZip inflation, namespace-aware XML and simple paragraphs/headings/runs/lists/links; retains original bytes and XML. `xml.js` also records each element's offsets in the caller's string (`start`, `openEnd`, `end`), which the writer splices by. The provisional typed model is documented in `read.js` because the shared session model has not landed | reader half of the format adapter; the session (#18) follows | #53; `docx-read.test.js`, `docx-write.test.js` |
| `formats/docx/write.js` | present | `writeDocx(model, meta, { limits }?)` → new package bytes: only changed paragraphs of `word/document.xml` are regenerated (pPr and unmodelled run properties kept), every other ZIP entry is copied unchanged, a new external hyperlink adds one relationship; the output is read back and must equal the edited model. Refusals are `DocxWriteError` with a code (`unsupported-edit`, `unrepresentable`, `unsafe-hyperlink`, `invalid-text`, `output-invalid`, ...). `docxAdapter` is the format contract adapter (open, serialize, scan) | the session's save path (#18); `formats/docx/read.js` supplies the model and meta | #54; `docx-write.test.js` |
| `formats/rtf/tokenize.js` | present | `tokenize(text)`: RTF into a flat token list with depth and length limits (`RtfLimitError`, `RtfSyntaxError`) | `formats/rtf/read.js` (#62), `scan.js` | #60; `rtf-tokenize.test.js` |
| `formats/rtf/scan.js` | present | `scanRtf(tokens)`: classifies supported and unsupported RTF features; an unknown destination opens its own group | the session's fidelity report (#55), `formats/rtf/read.js` | #61; `rtf-scan.test.js`, `rtf-scan-group-start.test.js` |
| `formats/rtf/write.js` | present | `writeRtf(model)`: the reader's model to ASCII RTF 1 (`\uN?` for non-ASCII, ansicpg1252 header); `RtfWriteRefusedError` for anything it cannot represent; `rtfAdapter` (`open`, `serialize`, `scan`) for the format contract: an unchanged model returns the original bytes, an edit from a source with unsupported features is refused | the session's save path (#18), which uses the fallback or save-as-copy on refusal | #63; `rtf-write.test.js` |
| `hosts/dav-save.js` | present | `guardedPut({ fetch, url, bytes, etag, requestToken, timeoutMs })`: one PUT with If-Match, outcome classified as saved, conflict, locked, auth, gone, error or ambiguous | `hosts/nextcloud.js` (#58) | #56; `dav-save.test.js` |
| `desktop/atomic-write.js` | present | `contentRevision(bytes)` (SHA-256) and `atomicReplace({ fs, path, bytes, expectedRevision })`: replace a file only if its current revision matches (`RevisionMismatchError` otherwise). The temp file is created exclusively (`wx`) with a random suffix, so a link at its name is never followed (#174) | `hosts/electron-document.js` (#72) | #173, #174; `atomic-write.test.js` |
| `desktop/nextcloud-cfg.js` | present | `configPaths(platform, env)` (client config locations per OS), `parseNextcloudCfg(text)` (accounts and sync folders), `localPathFor(accounts, accountUrl, remotePath)` | account and sync-folder mapping for `neocraft://` and Launch external (#26, #77) | #76; `nextcloud-cfg.test.js`, `nextcloud-cfg-review.test.js` |
| `desktop/open-args.js` | present | `parseOpenArgs(argv, { isPackaged, cwd, exts })`: files (.md, .markdown, .txt, .rtf) and `neocraft://` links from a command line, de-duplicated | `main.js` open-file / second-instance handling (#25) | #70; `open-args.test.js` |
| `desktop/origins.js` | present | Tailscale-only origin rules (D16): `isCanonicalOrigin(url)`, `matchEnrolled(url, enrolled)` (old LAN or http aliases only find an enrolled account) and `canonicalize(url, enrolled)`, so every link NeoCraft writes, sends or stores uses the server's Tailscale HTTPS name; URLs with userinfo or a `..` path segment are refused, and `canonicalize` assigns the path as a component so a leading `//` cannot become an authority. Browser global `NeoCraft_Origins` and `module.exports` | not called yet: Launch external (#77, #78) and `hosts/nextcloud.js` (#58) | #74; `origins.test.js`, `origins-review.test.js` |
| `document-session.js` | partial: core present, no view | `createDocumentSession({ adapter, host, recovery })` → `open`, `edit`, `save`, `getState`, `idle`: one document with its original bytes, base revision, dirty and saved generations, serial saves (`document-session/serial.js`) and an optional recovery draft (`document-session/drafts.js`); the storage host contract (`read`, `save` with a base revision; errors `conflict`, `offline`, `permission-lost`) is written at the top of the file. Not called from `app.js`, `main.js`, `preload.js` or `index.html`; the Document-mode view (#36), the autosave scheduler (#30) and the format adapters' wiring (#18, #55) are open | the Document-mode view (#36); calls a format adapter and a storage host | #34; `document-session.test.js` |

Fork hooks in upstream files, all marked `// NEOCRAFT:` in `main.js`: app name (`:36`), library folder name `NeoCraft Library` via `DEFAULT_LIBRARY_NAME` (`:46-47`, used in the chooser, fallback and startup paths), and the update check that queries `iannitram/neo` releases, never upstream (`:3665`, `:3720`). Also changed for the fork: `package.json` (`productName` NeoCraft, `appId com.iannitram.neocraft`, publish to `iannitram/neo`) and the `build.yml` / `pocket.yml` text above. `app.js` has no NEOCRAFT hooks; its fork-era changes are upstream's merged fixes plus the bound-shelf page-sheet save fix (#12, `openPageSheet` at :1699, covered by `page-sheet-save.test.js`).

## Planned 1.0 modules

Added 2026-10-26 for the approved spec ([SPEC.md](../../SPEC.md)). Rows marked *planned* do not exist on main; each names the issue that creates it. Modules that have since landed are listed in "NeoCraft modules on main" above and only referenced here. Child issues (#32-#78) split several rows into smaller files, named in the notes. Layout follows [NEXTCLOUD-PLAN.md](NEXTCLOUD-PLAN.md), "Architecture decision".

| Path | Status | Owns | Calls / called by | Issues |
|---|---|---|---|---|
| `document-session.js` | partial: the core is present (see "NeoCraft modules on main", #34, with `document-session/serial.js`, #32, and `document-session/drafts.js`, #35); no view calls it yet | One open file: original bytes, base revision, dirty and saved generations, fidelity report, serial saves, recovery draft. Still to come: the Document-mode view and the autosave scheduler | called by the Document-mode view; calls a format adapter and a storage host | #18, #36 |
| autosave scheduler (in the session) | planned | When to save: after a typing pause and on close | called by the session; calls `host.save` | #30 |
| `editor/` | planned | Editing behaviour extracted from `app.js` (typing, quotes, dashes, find, spellcheck), without book-only commands | used by the Document-mode view; `app.js` keeps books | #18 |
| `formats/txt.js` | planned | .txt reader/writer keeping line endings, BOM and encoding | used by the session | #19 |
| `formats/markdown.js` | planned (its parts `formats/markdown-frontmatter.js`, `formats/wikilinks.js` and `formats/span-patch.js` are present) | Byte-faithful .md: source spans, frontmatter held aside, wikilinks; builds on the landed `formats/markdown-frontmatter.js` and `formats/wikilinks.js`, and on the planned `formats/span-patch.js` (#47) | used by the session | #20, #49 |
| `formats/docx.js` + fidelity scanner (issues split it into `formats/docx/{limits,scan,read,write}.js`) | partial: limits (#51), scan (#52), read (#53) and write (#54, `formats/docx/write.js`) are present; the session's use of them (#18, #55) is not | Simple .docx read, package-patching write; lists features it cannot keep | used by the session; the scanner result drives the fallback | #21 |
| `formats/rtf.js` (issues split it into `formats/rtf/{tokenize,scan,read,write}.js`) | partial: tokenizer (#60), scanner (#61), reader (#62) and writer with its adapter (#63) are present; the session does not call them yet | Bounded .rtf reader/writer with the same scanner; [reader decision and subset](../RTF-READER.md) | used by the session | #23 |
| `hosts/nextcloud.js` | planned (`hosts/conflict-copy.js` and `hosts/dav-save.js` are present) | Browser storage host (reuses the landed `hosts/conflict-copy.js`; guarded PUT in `hosts/dav-save.js`, #56): authorized reads with ETag, If-Match saves, 412 -> exclusive copy | called by the session in the browser; talks to the `neocraft` PHP app and WebDAV | #22 |
| `hosts/electron-document.js` | partial: host, `main.js` routing and `neo.document` preload bridge are in; nothing in the page calls the bridge yet (Document mode is #36) | Desktop storage host: open by exact path, content-revision check, atomic replace (recovery is not in yet) | `main.js` (`requestDocument`, `document:*` handlers), `preload.js` (`neo.document`); the document session will call it from the page | #72 (Refs, still open), #25 |
| `main.js` hooks (`// NEOCRAFT:`) | partial: identity, library folder, update-feed and document open hooks (CLI argv, second-instance, macOS open-file; #72); `desktop/nextcloud-cfg.js` is not called yet | open-file / CLI / second-instance handling, `neocraft://` protocol, account and sync-folder mapping, WebDAV cache | calls `hosts/electron-document.js`; reads the Nextcloud client config | #25, #26 |
| `nextcloud/neocraft/` | partial: the empty scaffold (#45: `appinfo/info.xml`, `appinfo/routes.php` with one `page#index` route, `lib/AppInfo/Application.php`, `lib/Controller/PageController.php`, an empty `templates/main.php`, `composer.json`, `tests/Unit/PageControllerTest.php`) and `src/excluded.js` (#64); no file actions, WebDAV code or editor page yet | The Nextcloud PHP app: page route (the scaffold serves an empty page), authorized file operations, conflict copy, Files/Viewer actions, "+ New", excluded-folder delegation to Text, fallback to Collabora | serves the browser editor; called by Files | #17, #22, #24, #31 |
| `neocraft-bugreport.js` (loaded first by `index.html` and by the Nextcloud page) | planned | Report a bug: starts craft-bugreport-web's error buffer, mounts its standalone `mountReportButton` (the module bundles its own Vue; NEO stays framework-free), passes config and `getWorkingFile()` (the open document, as is). Desktop config comes from Electron settings through a new `window.neo.getBugReportConfig()` in `preload.js` (IPC to `main.js`); browser config from the `neocraft` PHP app's initial state | called by `index.html` / the Nextcloud page; calls the module, `preload.js` | #83, #84, #85 |
| `nextcloud/neocraft/appinfo/info.xml` + `.github/workflows/release.yml` (updates from the admin panel) | partial: `info.xml` is present with the fields below (id `neocraft`, version 0.0.1, PHP 8.2 minimum, Nextcloud 33); `.github/workflows/release.yml` is planned | The release fields the merged feed reads (id `neocraft`, a.b.c version, Nextcloud 33 range, PHP minimum; guarded by `scripts/neocraft-infoxml.test.js`) and a tag workflow that calls the app-store repo (private)'s `build-app.yml@v1` with `app_dir: nextcloud/neocraft`; signing and publishing on the release-key machine (R35), never in CI. Desktop releases are unchanged (D8) | called on version tags | #86, #87, #88 |
| build and release config (`package.json` `build`, `.github/workflows/`) | partial: NeoCraft identity, own update feed and unsigned three-OS tag builds are in (#8); PR unit tests and lint are in (`ci.yml`, #16) | NeoCraft identity, app id, own update feed, unsigned three-OS builds, PR tests | used by CI | #8, #16 |

```mermaid
flowchart LR
  VIEW["Document-mode view"] --> SES["document-session.js (+ autosave)"]
  SES --> FMT["formats/: txt, markdown, docx + scanner, rtf"]
  SES --> HOSTB["hosts/nextcloud.js (browser)"]
  SES --> HOSTD["hosts/electron-document.js (desktop)"]
  HOSTB --> NCAPP["nextcloud/neocraft/ PHP app + WebDAV"]
  HOSTD --> MAINH["main.js NEOCRAFT hooks: open-file, neocraft://, DAV cache"]
  NCAPP -->|Launch external| MAINH
```

## Planned automation modules (M8)

Added 2026-11-03 for Automation ([SPEC.md](../../SPEC.md), "Automation", N18-N21; [ROADMAP.md](../../ROADMAP.md), M8). All rows are *planned*; none exists on main, and each turns to present when its issue merges. Each issue has the `after-1.0` label. Desktop only: the browser editor and Pocket get no automation. Every file is new, under a new `automation/` folder, with its test in `scripts/` (`automation-*.test.js` for node:test, `automation.e2e.js` for the Electron runs, like the other `*.e2e.js`). Upstream files get only small `// NEOCRAFT:` hooks (D5). The design follows WordCraft's command line and MCP server (a backend with a headless and a connected implementation, one tool per method, read and write folder limits); only the ideas carry over, no code (it is Rust).

| Path | Status | Owns | Hooks in / called by | Issues |
|---|---|---|---|---|
| `automation/registry.js` | planned | Keeps every `ipcMain.handle` handler by channel so automation can call `library:read`, `library:listBooks`, `book:readMeta`, `book:writeMeta`, `book:create`, `chapter:read`, `chapter:write` (with its `expected` guard), `snapshot:*` and `export:save` in-process, the same code the page calls | a `// NEOCRAFT:` line in the IPC wrapper at `main.js:17` records each handler as it is registered | #196 |
| `automation/methods.js` | planned | The method table, the one list of words shared by the command line, MCP and scripts: `library.books`, `book.chapters`, `chapter.read`, `chapter.append`, `chapter.replace`, `chapter.add`, `book.counts` (words per chapter, total, `wordGoal`, the library's `dailyGoal`), `book.setGoal`, `search`, `book.export`, `book.snapshot`, `document.read`, `document.edit`, `app.state`, `app.screenshot`. Each entry: parameters, read-only or not, needs-page or not. Books and chapters are named by id or by exact title (an ambiguous title is an error that lists the ids) | calls `automation/registry.js`; `manuscript.js` (word counts); `document-session.js` + `formats/` + `hosts/electron-document.js` for `document.*` (#18, #72); the page responder for export and screenshot | #196 |
| `automation/chapter-text.js` | planned | Pure: chapter HTML to plain text (paragraphs, footnotes kept as text) and plain text to NEO chapter paragraphs, so append and replace write the HTML the editor writes | `automation/methods.js` | #196 |
| `automation/headless.js` | planned | The headless backend: NeoCraft's own Electron main process with no visible window, like `scripts/words.e2e.js` (it sets the paths, then `require('../main.js')`). `--library <folder>` runs on that folder with its own temporary settings folder, beside an open app; on my real library it holds the single-instance lock and refuses when the app is open. A hidden page (`show: false`) is loaded only for export and screenshot | started by `automation/cli.js`; window creation skipped by a hook in `createWindow` (`main.js:2541`) | #196 |
| `automation/page.js` | planned | Runs in the page (`index.html` loads it, one `// NEOCRAFT:` line): answers the requests that need upstream's page code, export (`exportFromShelf(bookId, format)` at `app.js:18117`, which runs `doExport` at :18144 on a book that is not open; formats txt, md, html, pdf, docx, epub; fountain and fdx for screenplays; the save dialog `export:save` shows is answered with the requested path for that one request), `app.state` (open book, chapter, mode) and edits to the book open in an attached window, which go through the editor's own save path so the open chapter is never overwritten underneath it | called by `automation/headless.js` (hidden page) and `automation/control.js` (attached) over IPC through `preload.js` | #196 |
| `automation/control.js` | planned | Attach, app side: a local socket (a named pipe on Windows, a socket file in the settings folder on macOS and Linux), newline-delimited JSON requests, each checked against a key file written at start (owner-only permissions on macOS and Linux). Off until *Allow Automation* (a checkbox in the app menu, saved in settings) is on, or the app is started with `--automation` | started by a hook in `main.js` after the window is ready; menu entry in the menu template (`main.js` near :3078) | #197 |
| `automation/remote.js` | planned | Attach, client side: the same method calls as headless, sent over the socket with the key; a clear message when the app is closed or automation is off | used by `automation/cli.js` (`--attach`), `automation/mcp.js`, `automation/script.js` | #197 |
| `automation/cli.js` | planned | Subcommands: `books`, `chapters <book>`, `read <book> <chapter>`, `append`, `replace`, `counts <book>`, `search <words>`, `export <book> <out> [--format]`, `text <file>` and `inspect <file>` (one document through `formats/` and the fidelity scanner), `run <script>`, `mcp`; flags `--library`, `--attach`, `--json`, `--help`. Unknown flags are errors | a `// NEOCRAFT:` hook in `main.js` before `requestSingleInstanceLock` (:3787): only a known subcommand as the first argument goes to the CLI; anything else (files, `neocraft://` links) goes on to `documentPathsFromArgv` (:3910 at startup, :3797 on a second instance) unchanged | #198 |
| `automation/mcp.js` | planned | MCP server: newline-delimited JSON-RPC 2.0 over stdio (`initialize`, `tools/list`, `tools/call`), one tool per method (`library.books` is `list_books`, and so on) with a JSON schema and a read-only hint; headless by default, `--attach` for the running app; `--read-root` / `--write-root` limit the files `export` and `document.*` may touch (the library itself is always reachable) | started by `neocraft mcp` (`automation/cli.js`) | #199 |
| `automation/script.js` | planned | Script files: one method per line in the same words (`chapter.append book="Draft" chapter="3" text=@notes.txt`; `@file` reads a value from a file beside the script), `#` comments, blank lines ignored. Parses and resolves every line before any runs, snapshots each book it names first (`snapshot:write`), stops at the first failing line and names it | `neocraft run` (`automation/cli.js`); File > Run Script... in the menu template (`main.js` near :3078), run through `automation/page.js` | #200 |

```mermaid
flowchart LR
  CLI["automation/cli.js (main.js hook before the single-instance lock)"] --> MCP["automation/mcp.js"]
  CLI --> SCRIPT["automation/script.js"]
  CLI --> METHODS["automation/methods.js"]
  MCP --> METHODS
  SCRIPT --> METHODS
  METHODS --> HEAD["headless: automation/headless.js (no visible window)"]
  METHODS --> REM["attached: automation/remote.js"] --> CTRL["automation/control.js in the running app"]
  HEAD --> REG["automation/registry.js: main.js IPC handlers"]
  CTRL --> REG
  HEAD --> PAGE["automation/page.js: app.js exports, state"]
  CTRL --> PAGE
  METHODS --> DOC["document-session.js + formats/ (1.0)"]
```

Mac, PC and Linux: the methods, scripts and MCP are plain JS and the same on every OS. Platform work: the attach socket is a named pipe on Windows and a socket file on macOS and Linux; headless on Linux with no display needs Chromium's headless mode (`--ozone-platform=headless`) or a virtual display for the hidden page (export to pdf, screenshot), checked on SteamOS; the packaged Windows app is a GUI program, so the CLI issue checks that its output reaches a terminal (and adds a small console launcher if it does not).

## Planned 1.1 modules

Added 2026-10-28 for the 1.1 modes release ([SPEC.md](../../SPEC.md), "1.1: Modes"; [ROADMAP.md](../../ROADMAP.md), M6). All rows are *planned*; none exists on main. Each issue has the `after-1.0` label and waits for the 1.0 list. Document mode (above) is built as the Notes editor, so the Notes rows reuse `document-session.js` and the formats.

| Path | Status | Owns | Hooks in / called by | Issues |
|---|---|---|---|---|
| `mode-shell.js` | planned | The Books / Scripts / Notes segmented control at the top center, last-mode memory, the search magnifier slot; mounts each mode's view | small `// NEOCRAFT:` hook in `index.html` / `app.js`; the browser editor page; Books view stays upstream's | #140 |
| `notes/library.js` | planned | Notes library: list, create, rename, delete .md notes over the storage host; side list | Notes view; calls `document-session.js` and `formats/markdown.js` (Document mode as the Notes editor) | #141, #142 |
| `notes/session-clock.js` | planned | Session clock and the `[mm:ss]` formatter (injected time source) | Notes view; the insert key | #143 |
| `scripts/fountain.js` | planned | Fountain parser and byte-faithful serializer, screenplay elements, hook for type extensions; reuses the screenplay and Fountain code now in `app.js` (section at line 5689) | Scripts view; two-column and podcast modules | #144 |
| `scripts/two-column.js` | planned | The two-column video-essay extension (narration, visuals, timings) on the Fountain model; documented in `docs/scripts-format.md` | Scripts view | #145 |
| `scripts/podcast.js` | planned | Podcast / audio extension (speakers, lines, music and segment cues) | Scripts view | #146 |
| `scripts/docx-export.js` | planned | Two-column script to .docx table | builds on the 1.0 docx writer (`formats/docx/write.js`); Scripts view menu | #147 |
| `search/index.js`, `search/ui.js` | planned | Local index over books, scripts, notes and opened documents; filters by mode; results panel | stores: `main.js` hook (desktop) and the host (browser); magnifier in `mode-shell.js` | #148, #149 |
| `writing/word-count.js` | planned | Word count and goals for Notes and Scripts (narration only in two-column) | Notes and Scripts status area; books keep `app.js` counters (section at line 12256) | #150 |
| `writing/pomodoro.js`, `writing/session-stats.js` | planned | Pomodoro state machine (injected clock), words per Pomodoro, history | toolbar control; reads `writing/word-count.js` | #151 |
| `writing/typewriter.js` | planned | Typewriter and focus mode scroll maths for Notes and Scripts; window-only in the browser | Notes and Scripts views; books keep `app.js` typewriter (line 14755) and focus mode (line 15286) | #152 |
| `desktop/typewriter-displays.js` | planned | Desktop only: one borderless dim grey cover window per display except the typing one, via Electron's `screen` API; hot-plug handling; any key or click returns focus | `main.js` hook and a `preload.js` IPC channel; called when typewriter mode starts and ends | #153 |

```mermaid
flowchart LR
  SHELL["mode-shell.js"] --> BOOKS["Books (upstream)"]
  SHELL --> NOTES["Notes: notes/ + Document mode editor"]
  SHELL --> SCR["Scripts: scripts/fountain.js + two-column, podcast"]
  SHELL --> SRCH["search/"]
  NOTES --> SES["document-session.js"]
  SCR --> DOCX["scripts/docx-export.js"]
  NOTES --> WT["writing/: word count, pomodoro, typewriter"]
  SCR --> WT
  WT --> DISP["desktop/typewriter-displays.js (Electron screen API)"]
```

## Planned 1.2 modules

Added 2026-11-01 for the 1.2 release ([SPEC.md](../../SPEC.md), "1.2"; [ROADMAP.md](../../ROADMAP.md), M7). All rows are *planned*; each issue has the `after-1.0` label.

| Path | Status | Owns | Hooks in / called by | Issues |
|---|---|---|---|---|
| `desk/index.js` | planned | Pure: a file listing (path, size, mtime, etag) plus picked and excluded folders to shelves of cover entries, sorted | Desk views on every host | #156 |
| `desk/cover-data.js` | planned | Title (frontmatter `title`, first heading, then file name), word count through the `formats/` readers, cover seed from the path; cached by ETag or mtime | `desk/index.js` entries; `covers.js` (upstream) draws them | #157 |
| `nextcloud/neocraft/` Desk page (`lib/Controller/DeskController.php`, `src/desk.js`) | planned | Top-bar navigation entry, folder picker saved per user, shelf view reusing NEO's shelf markup and `covers.js`; a cover opens the editor route | the `neocraft` app; WebDAV PROPFIND through `hosts/nextcloud.js` | #158 |
| `desk/local-host.js` | planned | The Desk over a synced local folder for the desktop (`preload.js` bridge) and Pocket (`pocket-bridge.js`) | Desk view on desktop and Pocket | #159 |
| `scripts/runtime.js` | planned | Pure: words per minute from a timed read; per-block runtime, explicit `mm:ss` overrides, running totals | two-column view (#145); teleprompter | #161 |
| `scripts/teleprompter.js` | planned | Narration-only scroll paced by runtimes, pause, speed nudge, mirror; second display via Electron `screen` (desktop), own window (browser) | two-column view; `main.js` window hook | #162 |
| `scripts/rough-cut.js` | planned | Pure: two-column script to the rough-cut plan JSON (markers, clip slots, narration chunks with start and duration); format written in `docs/rough-cut-plan.md` | Send to FilmCraft | #163 |
| `desktop/send-to-filmcraft.js` | planned | Desktop only: write the plan beside the script and start FilmCraft's CLI import (path from Settings) | menu command; `main.js` IPC | #164 |
| `history/sources.js` | planned | One ordered timeline of a document's revisions: Nextcloud versions (DAV `versions/`), recovery drafts (#35), desktop autosaves | Time River view | #167 |
| `history/para-diff.js` | planned | Pure: paragraph-level diff of two revisions (insert, delete, keep, move) | Time River and merge views | #166 |
| `history/river.js` | planned | The slider, ghost and highlight rendering, single-paragraph restore as one undo step | Document mode / Notes editor | #168 |
| `history/merge.js` | planned | Side-by-side conflict merge (keep mine, keep theirs, both), saved through the guarded save | `hosts/nextcloud.js` on a 412 after the copy (#57, #58) | #169 |

```mermaid
flowchart LR
  DESK["desk/index.js + cover-data.js"] --> NCDESK["neocraft Desk page"]
  DESK --> LOCAL["desk/local-host.js (desktop, Pocket)"]
  TWO["scripts/two-column.js (#145)"] --> RT["scripts/runtime.js"] --> TP["scripts/teleprompter.js"]
  TWO --> RC["scripts/rough-cut.js"] --> SEND["desktop/send-to-filmcraft.js"] --> FC["FilmCraft CLI import"]
  SRC["history/sources.js"] --> RIV["history/river.js"]
  DIFF["history/para-diff.js"] --> RIV
  DIFF --> MRG["history/merge.js"]
```

### Mac, PC and Linux

- **Formats, session and editor** are plain JS with no OS code; their Node tests (the modules on main already have them) are plain node:test and run on any OS; `ci.yml` runs them on all three OSes for every push and PR (#16). Tag builds on all three OSes already work (`build.yml`).
- **Windows:** NSIS + portable builds, x64 only (the only job that smoke-tests the installed app); the Nextcloud client config is `%APPDATA%\Nextcloud\nextcloud.cfg`; SmartScreen warns on first launch (accepted, D8).
- **macOS:** dmg and zip for arm64 and x64, unsigned (`identity: null`, no notarization) (right-click > Open); `open-file` events; the client uses File Provider placeholders, so open the exact path and never scan the folder; config in `~/Library/Preferences/Nextcloud/nextcloud.cfg`.
- **Linux / SteamOS:** AppImage, x64 and arm64 in `package.json` (the `.zsync` delta file is #103); the AppImage does not register handlers itself. The Depot launcher should install a user-level `~/.local/share/applications/neocraft.desktop` entry using the AppImage path in `Exec` (with `%U`), and run `update-desktop-database ~/.local/share/applications` when available. Include `x-scheme-handler/neocraft` and `MimeType=text/markdown;text/plain;text/rtf;application/rtf;`; this also registers md, txt and rtf while `.docx` remains WordCraft's. The Flatpak client config is under `<Flatpak config dir of com.nextcloud.desktopclient.nextcloud>/Nextcloud/`.
- **Browser:** the `neocraft` app targets Nextcloud 33; tested in a disposable server only.
- **1.2:** the Desk and Time River are plain JS plus the PHP app, the same on every OS; the teleprompter's second display and Send to FilmCraft are desktop only and need a manual check on Windows, macOS and SteamOS.

### Open-source pieces

Upstream NEO itself (MIT; keep the credits), electron-builder (already used), Nextcloud's app scaffold and frontend tooling for the PHP app (NEXTCLOUD-PLAN.md), our existing RTF tokenizer with no parser dependency ([decision and licence check](../RTF-READER.md), #62), and Nextcloud Login Flow v2 plus Electron `safeStorage` for the desktop app password (#26).

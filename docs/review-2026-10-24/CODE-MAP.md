# Neo / NeoCraft code map

Baseline: `iannitram/neo@3f21d090662cbcbd441d5207292e2c175ee1a01a` (2026-10-24). Line numbers below refer to that baseline, before the review documentation was added. See SYMBOL-INDEX.md for a generated top-level function/IPC index. Proposed Nextcloud modules are in NEXTCLOUD-PLAN.md; none currently exists.

## Runtime and data flow

```mermaid
flowchart LR
  UI["index.html + app.js + styles.css"] --> BR["preload.js: window.neo"]
  BR --> MAIN["main.js: IPC / filesystem / menus"]
  MAIN --> LIB["NEO Library: JSON + chapter HTML"]
  MAIN --> SPELL["spell-worker.js: Hunspell WASM"]
  MAIN --> BACK["backup-worker.js: ZIP + retention"]
  MAIN --> PRINT["offscreen Chromium + Paged.js"]
  MAIN --> ART["art.js: optional OpenAI cover generation"]
  MOBILE["Pocket WebView + shared editor"] --> PB["pocket-bridge.js: window.neo"]
  PB --> CAP["Capacitor filesystem + native plugins"]
  CAP --> PHONE["phone library / iCloud"]
```

Desktop uses contextIsolation and disables nodeIntegration. Browser-facing methods are in preload.js; storage work belongs in main.js. Pocket implements a second host API while copying the same editor code at build time. UI behavior is mostly a single 18,310-line file; main.js is 3,375 lines. Small independent modules already exist for covers, localization, spelling normalization and manuscript export.

## Entry points and major files

| File | Responsibility / useful starting point |
|---|---|
| `package.json` | Electron entrypoint, scripts, dependency/build configuration, product identity and updater publishing |
| `index.html` | Desktop DOM, CSP, scripts, shelf/editor/auxiliary panes; tightly coupled to app.js selectors |
| `preload.js` | Complete desktop `window.neo` API, IPC invoke/send/event mapping; synchronous initial locale/paper data |
| `main.js:15` | IPC error wrapper; logs and reports failures without changing handler timing |
| `main.js:43` | Library root selection, settings, language and writable-folder fallback |
| `main.js:378` | libName/bookDir boundaries; one-segment names, not symlink containment |
| `main.js:392` | Human-readable catalog regeneration |
| `main.js:443` | Rename retry, durable replace, fsync, JSON spare recovery |
| `main.js:486` | iCloud placeholder detection/download/wait; rebuild metadata at :612 |
| `main.js:641` | Library, book, chapter, auxiliary, snapshot, sidecar and cover IPC handlers |
| `main.js:1043` | Secret storage; cover painting starts at :1078 |
| `main.js:1175` | PDF window; ZIP export at :1267, export IPC at :1282 |
| `main.js:1323` | KDP geometry/hyphenation, Paged.js layout, exact page boxes and cover templates |
| `main.js:1697` | DOCX style/run importer; text decoder :1830; importFile :1845 |
| `main.js:2097` | Delayed backup utility-process orchestration |
| `main.js:2155` | Window setup; spelling request orchestration :2289; menus later in file |
| `main.js:3150` | Update lifecycle and fallback release queries; final section starts app/window lifecycle |
| `manuscript.js` | Pure model-to-DOCX parts / HTML export, font/paper/word-count/header rules; shared Node/browser module |
| `covers.js` | Seeded canvas cover rendering and title typography in renderer |
| `art.js` | Manuscript excerpt → brief → painted image, optional external API calls |
| `i18n.js`, `locales/` | Translation interpolation and regional fallback; English phrases are keys |
| `spell-worker.js`, `spell-ro.js` | Serialized Hunspell load/check/suggest/add and Romanian normalization |
| `backup-worker.js` | Bounded read waits, cloud exclusions, in-memory ZIP, durable output and retention |
| `styles.css` | Shared presentation tokens, book/editor/outline/print/accessibility styling |
| `print/` | Vendored Paged.js and TeX hyphenation engine/patterns; external code, not independently audited here |

## app.js navigation by section

| Baseline line | Feature and main concerns |
|---|---|
| 190 | Global library/book state, saved baselines, pending writes and device look |
| 728 | Bookshelf rendering, author/shelf/book operations |
| 1206 | Bound shelves, special pages and page sheets (separate save path) |
| 2499 | Open book and render chapters; hydrate chapter and sidecar state |
| 2836 | Typing, selection, paragraph transformations, normalization and paste |
| 3911 | Poetry/flush paragraph behavior; keyboard and style helpers follow |
| 5111 | Optional Vim-style movement |
| 5548 | Screenplay model, scenes, line classes, pagination and Fountain/FDX conversion |
| 7193 | Footnotes embedded in chapter HTML |
| 7419 | Placeholders/stickies and navigation |
| 7633 | Navigation pane and chapter operations |
| 8065 | Per-book and per-chapter notes pages |
| 8426 | Manuscript/Notes/Outline/Darlings tabs and editor swapping |
| 8774 | Structured outline and chapter/section relationships |
| 9201 | Outline cards, moving held writing, loose cards and scene/chapter manipulation |
| 12017 | Word, page and daily counters, goals integration |
| 12241 | Saving: diskKnown, chapterChain, persistChapter, metaSig, flushAllSaves |
| 12421 | Differential snapshots, manifests, retention and restore UI |
| 12995 | refreshFromDisk: chapter stamps, metadata/sidecar reconciliation, conflict twins |
| 13300 | Structural undo/redo, preservation of writing changed since snapshots |
| 13635 | Native speech synthesis read-aloud |
| 13820 | Find/replace and non-persisted CSS highlights |
| 14116 | Import-to-book UI and conversion |
| 14277 | Spellcheck pass, suggestions and typewriter scrolling |
| 14747 | Focus mode |
| 14920 | Goals/sprints/charts, then cover-art settings at 14974 |
| 15165 | Help, fonts and menu message handling |
| 15570 | Export/email entrypoints; manuscript format at 15695 |
| 15901 | Paperback/KDP and other export-building helpers |
| 17975 | Error reporting; Linux font handling, accessibility at 18037 |
| 18221 | Simple NEO feature gating and settings migration |

## Persistence model and ownership

```
NEO Library/
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

`npm test` runs `scripts/*.test.js` with node:test, mostly using VM-extracted functions or mocked Electron plus real temporary files. Suites cover filesystem/durability/cloud behavior, sync/daily counts, typing/paste, screenplay/import, spelling, snapshots, formatting, manuscript and print rules. `*.e2e.js` are separate Electron-driven integration scripts and are not part of npm test. They need a working Electron environment/assets. Read the bug report for actual run results and restrictions.

`.github/workflows/build.yml` builds desktop on version tags/manual dispatch, checks tag/package agreement, smoke-tests Windows and attaches draft release artifacts. `pocket.yml` builds native Pocket. Neither is PR unit/lint CI. `scripts/release.js`, `bundle.js` and `try.js` are upstream maintainer delivery tools; do not invoke them as part of reviewing or generating documents because they can push/release. `scripts/i18n.js` refreshes/checks string catalogs. This review adds only documentation plus a temporary-library diagnostic script in this folder, not production behavior.

## Change routing

- Save/conflict/recovery changes: app saving/refresh + main filesystem handlers + Pocket host, with injected-failure tests.
- Book formatting: app typing/captureBody + CSS + export serializers; verify that transient UI marks never enter chapter HTML.
- New host capability: explicit API and capability contract, adapter, call site and parity test. Document mode should use a smaller dedicated interface.
- Nextcloud conversion: new document core/formats/host/app modules; keep books on their existing API while fixing reviewed defects. Do not expose the Electron bridge directly to a web page.

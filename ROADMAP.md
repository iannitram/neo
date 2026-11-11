# NeoCraft — Roadmap

*A fork of [hughhowey/neo](https://github.com/hughhowey/neo) (MIT) by iannitram. Drafted 2026-10-23 from a design Q&A session.*

Updated: 2026-11-11

features:
- fork: Fork identity, builds, checks, monthly upstream merges and project rules (M0, Ongoing)
- books: Books and Pocket keep working: review fixes to saves, conflicts and exit, plus book and Pocket requests
- document-mode: Document mode: the one-file session, the editor host and typing (M1)
- md-txt: Byte-faithful Markdown and source-preserving .txt (M1)
- docx: Simple .docx round trip, fidelity scanner and warning (M1)
- rtf: .rtf reader, writer and unsupported-feature scanner (M3)
- nextcloud-saves: Nextcloud reads, ETag-guarded saves, conflict copies and autosave (M2)
- nextcloud-app: The neocraft Nextcloud app: Files handler, fallbacks, "+ New", packaging and admin-panel updates (M2, M3)
- bug-report: Report a bug in the browser editor and the desktop app
- desktop-docs: Desktop Document mode, open-file handling and file associations (M4)
- launch-external: Launch external: the neocraft:// handoff, Tailscale-only addresses and the guarded DAV cache (M4)
- cutover: Cutover: a real week of use, then Collabora removed (M5)
- automation: After 1.0: command line, MCP server and script files (M8)
- modes: After 1.0: the mode switch and Notes (M6, 1.1)
- scripts: After 1.0: Fountain scripts: screenplay, two-column video essay, podcast (M6, 1.1)
- search: After 1.0: search across books, scripts, notes and opened documents (M6, 1.1)
- writing-tools: After 1.0: word count and goals, Pomodoro, typewriter mode (M6, 1.1)
- desk: After 1.0: the Desk (M7, 1.2)
- script-to-cut: After 1.0: Script to cut: runtimes, teleprompter, Send to FilmCraft (M7, 1.2)
- time-river: After 1.0: Time River: version slider and conflict merge (M7, 1.2)

## What NeoCraft is

NeoCraft is NEO plus a **Document mode** and a **Nextcloud web editor**. It replaces the Collabora office plugin in Nextcloud Files and adds installable desktop apps for Windows, macOS and Linux (SteamOS) that edit the same files.

- **In the browser:** clicking a `.docx`, `.rtf`, `.md` or `.txt` file in Nextcloud Files opens it in NeoCraft. A **Launch external** button hands the file to the desktop app.
- **On the desktop:** NeoCraft edits files right in the local Nextcloud folder. The Nextcloud desktop client already handles sync and offline use.
- **Books keep working exactly as Hugh built them.** Document mode sits beside them.

## Decisions (settled 2026-10-23)

| # | Decision | Ruling |
|---|---|---|
| D1 | NeoCraft vs WordCraft | **Split by job.** NeoCraft is the writing app (md, txt, rtf, simple docx) and the browser editor. WordCraft stays the heavy, Word-style desktop docx editor. |
| D2 | Books vs documents | **Add Document mode.** One file is one document: it opens in place and saves back in its own format. No chapters, library or covers. Pressing Enter three times does not start a chapter. |
| D3 | .docx it can't fully keep | **Warn and offer options; never silently overwrite.** On open, NeoCraft scans for parts it can't hold (tables, headers and footers, comments, tracked changes, images, fields). If it finds any, it offers *Open in Collabora* (in the browser, while Collabora is installed) or *Launch in WordCraft* (desktop), or *Save my edits as a copy*. |
| D4 | Markdown | **Byte-faithful.** Frontmatter is hidden and written back untouched. Lines you didn't edit are never rewritten. `[[wikilinks]]` survive. Folders on a configurable **excluded list** (for example, a folder of machine-written notes) are left to the Nextcloud Text app in the browser and are not in NeoCraft's desktop defaults. |
| D5 | Upstream | **Track Hugh.** Our code goes in new files (the Nextcloud bridge, Document mode, the RTF reader) with small, marked hooks into `app.js`/`main.js`. We merge `upstream/main` once a month. |
| D6 | Collabora | **Demote, then remove.** NeoCraft becomes the default and Collabora stays installed as the complex-docx fallback. We uninstall it after NeoCraft survives a real week of use. This server has a single document editor, so no other users are affected. |
| D7 | Desktop sync | **Use the Nextcloud client.** NeoCraft has no sync engine of its own. |
| D8 | Name and releases | **NeoCraft**, with its own app ID (`com.iannitram.neocraft`). Updates come from `iannitram/neo` releases. Builds are unsigned: on macOS the first launch is right-click → Open, and Windows shows a SmartScreen warning. |
| D9 | Where tracking lives | This file, GitHub issues per milestone, and a `depot.json` entry (following the WordCraft precedent of 2026-10-20). |
| D10 | Launch external on a file this machine doesn't sync | **Pull it down and write it back.** The desktop app fetches the file over WebDAV, edits a cached copy, and uploads on save. Synced files open straight from the local folder. |
| D11 | Browser file types | NeoCraft handles **.docx, .rtf, .md and .txt** (it takes .md and .txt over from Nextcloud Text, except in excluded folders). |
| D12 | Same file open in two places | **Hand-off plus guarded saves.** *Launch external* turns the browser tab read-only. Every save checks the server's ETag (If-Match), so a file that changed underneath is saved as a copy, never overwritten. |
| D13 | Nextcloud "+ New" menu | Two entries: **New document (.docx)** and **New note (.md)**. |
| D14 | Build order | **Browser button first.** The goal is getting Collabora out of the way as early as possible. |
| D15 | Desktop double-click defaults | NeoCraft opens **md, txt and rtf** (it takes .rtf from WordCraft). WordCraft keeps **.docx**. *Launch external* always opens NeoCraft. |
| D16 | Server addresses | **Tailscale secure links only** (owner's rule, 2026-10-23). Every server URL NeoCraft writes, sends or stores is the server's Tailscale HTTPS name (`https://<server>.<tailnet>.ts.net:<port>`). Bare LAN hostnames and plain `http://` addresses are never written into links. They're accepted only as incoming aliases from an older client config. |

## Why this is doable: what's already in NEO

- **The editor never touches the disk.** Every read and write goes through one bridge, `window.neo` (`preload.js`, about 60 calls). NEO Pocket already ships a second version of that bridge (`pocket/www/pocket-bridge.js`, 777 lines) that runs the same `app.js` inside Capacitor. A Nextcloud bridge is a third version, the same shape talking WebDAV.
- **No build step.** It's plain JS, HTML and CSS, so the same `app.js` and `styles.css` can be served from a Nextcloud app.
- **What it doesn't have yet:** NEO's .docx import is a regex reader that keeps only paragraphs, bold and italic, and it doesn't read .rtf at all. Its data model is a library of books, with each chapter saved as an HTML file. Document mode and real format round-tripping are the new work.

The target server holds thousands of .md files and several hundred each of .txt, .docx and .rtf, with almost no .odt or .doc. It runs Nextcloud 33 with `richdocuments` 10.3.2 (Collabora) and `text` 7.0.1.

---

## Milestones

Each milestone ends with something usable.

### M0 — Make it ours (setup)

- Rename to NeoCraft: `productName`, `appId` `com.iannitram.neocraft`, and `build.publish` pointing at `iannitram/neo`, so it never auto-updates from Hugh's releases or clashes with an installed NEO. Use its own library and settings folder name.
- Set up GitHub Actions to build all three platforms on the fork: Windows NSIS + portable, macOS dmg (arm64 + x64, unsigned, `notarize: false`), and Linux AppImage x64. Hugh's `build.yml` is the starting point.
- Set up a monthly upstream merge (`git fetch upstream && git merge upstream/main`). Mark every hook in Hugh's files with a `// NEOCRAFT:` comment so merges stay readable.
- Add a `depot.json` entry: `replaces: "Nextcloud Office (Collabora)"`, default_for md/txt/rtf (D15), and a golden task (below).
- **Done when:** a NeoCraft build from CI installs on Windows next to Hugh's NEO, and the two don't touch each other.

### M1 — Document mode in the editor (for the browser)

The browser editor *is* Document mode, so this comes first even though desktop delivery comes later.

- A new `document.js` module: open one file, edit it, save it back in its own format. It reuses NEO's typing, curly quotes, dashes, find and spellcheck. Book-only machinery stays off: no chapters on triple Enter, no drop caps, shelf, covers, darlings, outline or goals. This is a NEO "view," like `#editor-view`, with a minimal hook in `app.js`.
- Format layer (`formats/`), each format as a pure reader/writer pair with Node tests:
  - **.txt:** keep the line endings and encoding (UTF-8 or the original codepage, detected on open).
  - **.md:** byte-faithful (D4). Read it into a model that remembers each block's original source text, and on save re-emit only the blocks that changed. Frontmatter is held aside verbatim. Test it against a sample of real-world pages: open → save with no edits must give **identical bytes**.
  - **.docx (simple):** real paragraphs, headings, bold/italic/underline, lists and links. Read with a proper OOXML reader, not NEO's regex importer. Write by patching the original package (keep `styles.xml`, `settings.xml`, theme and `docProps`, and replace only `word/document.xml`'s body), so Word-side styles survive.
  - **Fidelity scanner** (D3): before editing, list what the file holds that the model can't keep. A non-empty list triggers the warning. Tests use fixtures for each feature it should flag.
- **Done when:** a sample of 50 real-world .md files (with frontmatter and `[[wikilinks]]`) saves byte-identical with no edits, a simple .docx made in WordCraft round-trips and reopens cleanly in WordCraft, and a docx with a table triggers the warning.

### M2 — The Nextcloud button (browser, .docx first)

- **A Nextcloud app, `neocraft`**, installed in the server's `custom_apps/`. It serves NeoCraft's editor page and registers as the Files/Viewer handler for .docx. It's an iframe page under Nextcloud's own login, so it needs no separate account.
- **`nc-bridge.js`:** a third implementation of the `window.neo` surface Document mode uses, over WebDAV with the session's request token. Reads take the ETag. Saves use **If-Match** (D12), and a 412 means *save as copy* plus a notice. Autosave waits until typing pauses (a few seconds idle) plus on close, so Nextcloud's version history doesn't fill with a version per keystroke.
- **Fallback (D3/D6):** if the fidelity scanner flags a file, the user gets *Open in Collabora* (opens the file with `richdocuments`), *Save my edits as a copy*, or *Cancel*.
- **Demote Collabora:** NeoCraft becomes the default .docx handler, and Collabora stays installed for the fallback.
- **Spike first (half a day):** confirm how Nextcloud 33 resolves two apps claiming the same type (Viewer handler order and file-action priority), and how richdocuments takes the default. This is the riskiest unknown in the whole plan, so it's measured before M2 starts.
- **Updates from the admin panel** (SPEC M18): the `neocraft` Nextcloud app ships as signed releases through the merged app-store feed (the app-store repo (private)), offered on the Apps page and installed by its scheduled job (#86, #87, #88). Desktop updates stay as D8 says.
- **Done when:** clicking a simple .docx in Nextcloud Files opens NeoCraft, edits save back as a new Nextcloud version, a complex one routes to Collabora, and two tabs on the same file never overwrite each other.

### M3 — The rest of the browser: .rtf, .md, .txt, and "+ New"

- **.rtf reader/writer.** Reading uses a maintained RTF parser and maps it to the same model. Writing is a small, deliberate RTF writer. The same fidelity scanner covers it (embedded objects, tables, fonts it can't map). There are 441 files to test against: sample them and record which features show up.
- **.md and .txt** move from Nextcloud Text to NeoCraft, **except paths in excluded folders**, which still open in Text (D4/D11). If Nextcloud's handler can't filter by path, NeoCraft's handler checks the path and passes those files to Text.
- **"+ New" menu** entries: *New document (.docx)* and *New note (.md)* (D13).
- **Done when:** all four types open from Files, excluded-folder pages still open in Text, and the M1 byte-identical test still passes when it runs through the browser bridge.

### M4 — Desktop apps and Launch external

- **Desktop Document mode:** `main.js` gets open-file handling (file association + the command-line path + macOS `open-file`). It's the same `document.js` and `formats/` on the existing Electron bridge, and saves check the file's modified time (the local version of If-Match).
- **OS defaults (D15):** NeoCraft takes md, txt and rtf, and WordCraft keeps docx. The Depot launcher writes these at install.
- **Launch external (D10/D12):**
  - The browser button opens `neocraft://open?server=<host>&path=<dav path>&etag=<etag>` and turns its own tab read-only.
  - The desktop app registers the `neocraft://` scheme. On Linux the AppImage doesn't register it by itself, so the Depot launcher installs a `.desktop` entry with `x-scheme-handler/neocraft`.
  - **Path mapping comes from the Nextcloud client's own config,** with no setup. `nextcloud.cfg` lists the account URL and each folder pair. Locations: `%APPDATA%\Nextcloud\nextcloud.cfg` (Windows), `<Flatpak config dir of com.nextcloud.desktopclient.nextcloud>/Nextcloud/nextcloud.cfg` (SteamOS Flatpak), `~/Library/Preferences/Nextcloud/nextcloud.cfg` (macOS).
  - **Server matching follows D16.** The `neocraft://` link always carries the Tailscale HTTPS name. On the desktop side, a client config may still hold an older local name (for example `http://<lan-name>:<port>` with the local folder mapped to `/`), so NeoCraft treats those names as the same server for **lookups only**. Every WebDAV call it makes (cache pull-down, upload) goes to the Tailscale HTTPS URL. The NC app's links, the "+ New" entries, and the Login Flow v2 server are all the Tailscale name too, so everything works off the LAN.
  - **The file isn't synced here (selective sync):** fetch it over WebDAV into a cache, edit, and upload with If-Match. Auth uses Nextcloud Login Flow v2, so the app password lives in Electron `safeStorage` (NEO already stores its OpenAI key this way) and never in the synced folder.
  - **macOS note:** the macOS client uses File Provider placeholders, and reading a placeholder downloads it, so open the exact path and never scan the folder.
- **Done when:** on Windows, SteamOS and macOS, *Launch external* on a synced file opens it locally, an unsynced file round-trips through the cache, and the browser tab shows read-only until the desktop saves.

### M5 — Cutover

- A **real week** of using NeoCraft for his actual documents, with every friction point filed as an issue.
- Then **uninstall `richdocuments` and the Collabora container**. Before that, back up the Collabora config and record the reinstall recipe in the KB. After it, the complex-docx fallback becomes *Launch in WordCraft*.
- Update the Depot stability fields from the golden task's evidence, not by eye.

### M8 — Automation: command line, MCP server, scripts (after 1.0, built before 1.1)

*Added 2026-11-03, my decision. Not part of 1.0: SPEC.md's 1.0 definition is unchanged, and every issue here has the `after-1.0` label. Numbered M8 because M6 and M7 were already taken; it is built before them. SPEC.md "Automation", N18-N21.*

The point: an AI agent, or I, can drive NeoCraft with no window. Testing and iteration get much faster (a script or an agent checks a change instead of me clicking through it), and an AI can use NeoCraft as a tool on my books.

**Why here, between 1.0 and 1.1.** 1.0 must not grow. Everything Automation drives exists once 1.0 is done: upstream's library and exports, and 1.0's document session and formats (#18, #72). 1.1 and 1.2 are mostly new views (modes, Notes, Scripts, search, the Desk, Time River), and they are the work that gains most from being checked by script, so Automation comes first. After 1.2 would waste that gain; inside 1.1 would blur that release's "modes" definition. As 1.1 and 1.2 features land, each one adds its own method (for example, search moves onto 1.1's index, #148).

**How it fits NEO.** WavCraft's split (a core, a command line, an MCP server, script files) carries over. The design follows WordCraft's command line and MCP server (a `Backend` with a headless and a connected implementation, one tool per method, read and write folder limits). Only the ideas carry over: WordCraft is Rust and this is plain JS, so no code is copied. What is different in NEO:

- **Headless is NeoCraft's own Electron main process with no visible window,** the way the `scripts/*.e2e.js` tests already run it. Upstream's library code is inside `main.js` (the IPC handlers) and its exports are built by `app.js` in the page, so the core calls those same handlers and, for exports and screenshots only, a hidden page. It does not grow a second copy of the library or export code, and our hooks into `main.js` stay small and marked (D5).
- **Attach drives the running app** through a local socket guarded by a key file. It is off until I turn on *Allow Automation* (a menu checkbox) or start the app with `--automation`.
- **One writer per library.** Headless on my real library refuses while the app is open and says to use `--attach`. With `--library <folder>` it runs on its own copy beside the open app (what tests and agents use).
- **Scripts are undone with a snapshot,** not a long undo chain: NEO saves every edit straight to disk, so a script run (headless or in the window) first takes a NEO snapshot, named for the script, of each book it names, and restoring that snapshot undoes the whole run. Every line is checked before the first one runs.
- **Dropped: automation for the Nextcloud browser editor and for NEO Pocket.** The browser editor's files are already reachable over WebDAV, and Pocket is a phone app with no command line. Automation is desktop only, on Windows, macOS and SteamOS.

The methods, the same words in the command line, the MCP tools and script files: list books, list chapters, read a chapter, append to a chapter, replace a chapter (guarded by its revision), add a chapter, word counts and goals, search across manuscripts, export (txt, md, html, pdf, docx, epub; fountain and fdx for screenplays), take a snapshot, read and edit one document (.md, .txt, .rtf, .docx) through 1.0's document session, and, attached, what is open plus a screenshot of the window. Paperback for KDP and Manuscript Format stay in the window, because they open a settings dialog.

Build order and issues:

1. Core, headless (N18a, #196), then attach (N18b, #197).
2. Command line (N19, #198).
3. MCP server (N20, #199) and script files (N21, #200) side by side.

- **Done when:** an AI agent completes 10 real writing tasks on a test library through the MCP server with no window (N20's test), the same tasks pass attached to a running app, and the command line works on Windows, macOS and SteamOS.

### M6 — Modes (1.1, right after 1.0)

*Added 2026-10-28 in the design review (owner: "Yes, update and file (Recommended)"). 1.0 is unchanged and ships first; every issue here has the `after-1.0` label. NeoCraft keeps NEO's look and design.*

A mode switch at the top center (Books, Scripts, Notes), styled like NEO's toolbar, remembering the last mode; Search is a magnifier at the right of the same bar. 1.0's Document mode is built as the Notes editor, so this release adds around it instead of redoing it.

- **Notes:** the home for .md notes (a library with a side list). Any single file opened from Nextcloud (docx, rtf, txt, md) opens in the same editor. A session clock with a key that inserts `[mm:ss]` at the cursor.
- **Scripts:** stored as Fountain plain text (.fountain). Two-column video-essay script first (narration beside visuals and clips, with timings), then podcast or audio script, then screenplay (standard Fountain). Two-column scripts export to .docx as a two-column table.
- **Search:** across books, scripts, notes and documents opened from Nextcloud, with filters by mode, in the desktop app and the browser editor. Not all of Nextcloud.
- **Writing tools:** word count and goals in Notes and Scripts; a Pomodoro timer (25 / 5 / 15 after every 4, adjustable) with session word count, words per Pomodoro and a history view; focus or typewriter mode. On the desktop, typewriter mode covers every other display with a borderless dim grey window (any key or click returns focus); in the browser it covers just its own window.

Build order and issues (details in each issue; SPEC.md "1.1: Modes", N1-N11):

1. Mode switch shell (#140), then Notes library and editor (#141) and Nextcloud files in the Notes editor (#142); these reuse 1.0's Document mode. Session clock and timestamp key (#143).
2. Fountain model and screenplay type (#144), then the two-column video-essay script (#145).
3. Search index (#148) and search UI (#149); word count and goals (#150); Pomodoro and session stats (#151); typewriter mode in the window (#152) and across displays on the desktop (#153).
4. Podcast script type (#146) and .docx export of two-column scripts (#147).

- **Done when:** the owner can switch modes, keep notes and scripts, search them, and write a Pomodoro session with typewriter mode on a two-display desktop, on Windows, macOS and SteamOS, and in the browser editor for what applies there.

### M7 — Desk, Script to cut, Time River (1.2, after 1.1)

*Added 2026-11-01 (owner: "All three (Recommended)"; Time River "After 1.0 (Recommended)"). Every issue has the `after-1.0` label. SPEC.md "1.2", N12-N17.*

- **The Desk:** NeoCraft gets its own page in Nextcloud's top bar. Folders the owner picks are shelves; documents are covers with NEO's seeded art and a word count. The same Desk shows in the desktop app and NEO Pocket from the synced folder. NeoCraft stops being only a file opener and becomes a place to start writing. The editor itself stays plain (D2 holds inside a document).
- **Script to cut:** the two-column video-essay script (#145) gets live runtimes from the owner's measured reading speed, a teleprompter on a second display, and *Send to FilmCraft*: a rough-cut plan that FilmCraft opens as a sequence with named markers, labelled empty clip slots and a scratch narration track (FilmCraft's Kokoro text-to-speech). Desktop only.
- **Time River:** a history slider over every Nextcloud version and local autosave of a document, with removed paragraphs shown as ghosts, added ones highlighted, and single-paragraph restore. A conflict (spec Must M8) keeps its copy and then opens the same view side by side to merge per paragraph. Prior art: upstream PR #369 (git history), #466/#467 (conflict twins), the neo-scribe fork's history window (issue #155).

Build order and issues:

1. Desk index (pure, #156) and cover data (#157), then the Desk page (#158), then desktop and Pocket (#159). Tracker #160.
2. Runtimes (#161), teleprompter (#162); rough-cut plan (#163) and FilmCraft import (iannitram/filmcraft#112, in FilmCraft) before Send to FilmCraft (#164). Tracker #165. Needs #145.
3. Paragraph diff (#166) and the history source (#167), then the slider (#168), then the conflict merge view (#169). Tracker #170. Needs #57 and #58.

- **Done when:** the owner starts a writing day from the Desk in the browser and on the desktop, records a video essay from the teleprompter and opens its rough cut in FilmCraft, and recovers a deleted paragraph and merges a two-tab conflict from the Time River.

### Ongoing

- Monthly `upstream/main` merges, running Hugh's tests plus ours.
- Anything that's useful to every NEO user (an RTF reader, maybe Document mode) can go to Hugh as a PR. That's his call; he's opinionated about bloat (see his CONTRIBUTING.md).

## Golden task (the Depot's stability check)

> Open a real .docx from Nextcloud Files in the browser, fix a paragraph, *Launch external*, keep editing on the desktop, save, then reopen it in the browser and see the edit. Then open a real .md with frontmatter, save it without changes, and confirm the bytes didn't change.

## Risks to watch

- **Nextcloud handler precedence** between Collabora, Text and NeoCraft. That's the M2 spike. If Nextcloud can't hand a type to NeoCraft cleanly, M2 becomes "disable Collabora's handler for .docx" instead.
- **DOCX round-trip is a deep hole.** The rule that keeps it shallow: NeoCraft edits only what its model holds, patches the original package, and anything else goes to the fallback. It never grows a table editor.
- **`app.js` is 18k lines, and Hugh changes it daily.** Every hook stays small and marked, and the real work lives in our own files.
- **Byte-faithful markdown is easy to claim and hard to prove.** The no-edit byte test on real-world pages is the gate, run on every build.
- **Unsigned builds:** Gatekeeper and SmartScreen will complain on first launch. That's a known, accepted cost (D8).

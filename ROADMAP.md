# NeoCraft — Roadmap

*A fork of [hughhowey/neo](https://github.com/hughhowey/neo) (MIT) by iannitram. Drafted 2026-10-23 from a design Q&A session.*

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
  - **Path mapping comes from the Nextcloud client's own config,** with no setup. `nextcloud.cfg` lists the account URL and each folder pair. Locations: `%APPDATA%\Nextcloud\nextcloud.cfg` (Windows), `~/.var/app/com.nextcloud.desktopclient.nextcloud/config/Nextcloud/nextcloud.cfg` (SteamOS Flatpak), `~/Library/Preferences/Nextcloud/nextcloud.cfg` (macOS).
  - **Server matching follows D16.** The `neocraft://` link always carries the Tailscale HTTPS name. On the desktop side, a client config may still hold an older local name (for example `http://<lan-name>:<port>` with the local folder mapped to `/`), so NeoCraft treats those names as the same server for **lookups only**. Every WebDAV call it makes (cache pull-down, upload) goes to the Tailscale HTTPS URL. The NC app's links, the "+ New" entries, and the Login Flow v2 server are all the Tailscale name too, so everything works off the LAN.
  - **The file isn't synced here (selective sync):** fetch it over WebDAV into a cache, edit, and upload with If-Match. Auth uses Nextcloud Login Flow v2, so the app password lives in Electron `safeStorage` (NEO already stores its OpenAI key this way) and never in the synced folder.
  - **macOS note:** the macOS client uses File Provider placeholders, and reading a placeholder downloads it, so open the exact path and never scan the folder.
- **Done when:** on Windows, SteamOS and macOS, *Launch external* on a synced file opens it locally, an unsynced file round-trips through the cache, and the browser tab shows read-only until the desktop saves.

### M5 — Cutover

- A **real week** of using NeoCraft for his actual documents, with every friction point filed as an issue.
- Then **uninstall `richdocuments` and the Collabora container**. Before that, back up the Collabora config and record the reinstall recipe in the KB. After it, the complex-docx fallback becomes *Launch in WordCraft*.
- Update the Depot stability fields from the golden task's evidence, not by eye.

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

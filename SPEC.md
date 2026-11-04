# NeoCraft: spec

**Approval:** 2026-10-26, the owner, in the Project Manager session's question tool: "Approve, 1.0 = M5 (Recommended)". The spec is the decisions D1-D16 and milestones M0-M5 in [ROADMAP.md](ROADMAP.md), as written on 2026-10-23. A changed Must or Won't sets this back to "not yet".

**2026-10-28:** design review; 1.0 re-confirmed unchanged; 1.1 modes release added (owner: "Yes, update and file (Recommended)"). The 1.0 Musts below are unchanged apart from two clarifications (M7: a 5-second pause; M11: which folders are excluded). The new Musts N1-N11 are in "1.1: Modes".

**2026-11-03:** Automation (command line, MCP server, scripts) added after 1.0 and before 1.1, my decision: "Automation", N18-N21. The 1.0 definition and the 1.0 Musts are unchanged.

Must M17 added 2026-10-26 by the owner: "This will all apply to Neo as well" (with the bug-report answers given for the Craft web apps the same day: "Yes, a 1.0 Must (Recommended)", "Launcher set, browser version (Recommended)", "Same File Drop (Recommended)", "One shared module repo (Recommended)").

Must M18 added 2026-10-26 by the owner: "This will all apply to Neo as well" (with the app-update answers given for the Craft Nextcloud apps the same day: "Private app store feed (Recommended)", "Yes, a 1.0 Must (Recommended)"; the requirement: "One feature that needs to work….once installed our plugins should update from the nextcloud admin panel, pulling updates automatically."). It covers the NeoCraft Nextcloud app (`nextcloud/neocraft/`) only; the desktop builds keep updating from this repo's releases as D8 says.

**1.0 means:** the owner has used NeoCraft for a real week on his actual documents, in Nextcloud Files in the browser and on the desktop, and Collabora has then been uninstalled (milestone M5).

NeoCraft is NEO plus a **Document mode** and a **Nextcloud web editor** (ROADMAP.md, "What NeoCraft is"). Books keep working exactly as upstream built them; Document mode sits beside them.

## Musts

Each Must is checked by a test or by steps someone else can repeat. Milestone and decision ids refer to ROADMAP.md. Build order and gates: [docs/review-2026-10-24/ROADMAP.md](docs/review-2026-10-24/ROADMAP.md) (R0-R6, mapped below).

| # | Must | Done looks like | Check | Issues |
|---|---|---|---|---|
| M1 | WHEN a NeoCraft build is installed next to upstream NEO, THE APP SHALL use its own name, app id `com.iannitram.neocraft`, settings and library folder, and update only from `iannitram/neo` releases (M0, D8). | Both apps run on one machine and never touch each other's library, settings or update feed. | Install the CI build on Windows beside NEO; open each; check settings folders and the update URL. | #8 |
| M2 | THE FORK SHALL build unsigned installers for Windows (NSIS + portable), macOS (dmg arm64 + x64) and Linux (AppImage x64) in CI, and run the unit tests on every PR (M0, D8). | A tag produces all desktop artifacts named NeoCraft; a PR shows the test run. | GitHub Actions run on a PR and on a tag. | #16 |
| M3 | WHEN one file is opened in Document mode, THE APP SHALL edit it in place and save it back in its own format, with no chapters, shelf, covers, drop caps, outline or goals (M1, D2). | Triple Enter does not start a chapter; the saved file is the same format it was opened in. | Unit tests on the document session; open a .txt, edit, save, reopen. | #32, #33, #34, #35, #36 (tracker #18) |
| M4 | WHEN a Markdown file is saved, THE APP SHALL keep frontmatter verbatim, leave unedited lines byte-identical and keep `[[wikilinks]]` (M1, D4). | 50 real-world .md files save byte-identical with no edits; a one-line edit changes only that line. | No-edit byte test on the corpus, run on every build. | #46, #47, #48, #49, #50 (tracker #20) |
| M5 | WHEN a .txt file is saved, THE APP SHALL keep its line endings, BOM and encoding (M1). | Fixtures in UTF-8, UTF-8 with BOM, CRLF and a legacy codepage come back byte-identical. | Format adapter fixture tests. | #19 |
| M6 | WHEN a .docx is opened, THE APP SHALL edit paragraphs, headings, bold/italic/underline, lists and links, save by patching the original package, and warn before editing anything it cannot keep (tables, headers and footers, comments, tracked changes, images, fields) (M1, D3). | A simple .docx made in WordCraft round-trips and reopens cleanly in WordCraft; a .docx with a table shows the warning. | Fixture tests per flagged feature; WordCraft round-trip. | #51, #52, #53, #54, #55 (tracker #21) |
| M7 | WHEN a simple .docx is clicked in Nextcloud Files, THE APP SHALL open it in NeoCraft under Nextcloud's own login and save edits back as a new Nextcloud version, autosaving after about a 5-second typing pause and on close, not per keystroke (M2). | The file opens in NeoCraft; Nextcloud's version list gains one version per pause, not one per key. | In a disposable Nextcloud 33: click, edit, wait, check versions. | #17, #45, #56, #57, #58, #59, #66, #30 |
| M8 | WHEN a save finds the file changed on the server, THE APP SHALL save the edits as a copy and say so, never overwrite (D12). | Two tabs on one file never overwrite each other; a 412 produces a copy plus a notice. | Two-tab conflict test against the disposable server. | #56, #57, #58 (tracker #22) |
| M9 | WHEN the fidelity scanner flags a file, THE APP SHALL offer *Open in Collabora* (browser, while installed) or *Launch in WordCraft* (desktop), *Save my edits as a copy*, or *Cancel* (D3, D6). | A complex .docx routes to the fallback; nothing is silently overwritten. | Open the table fixture in the browser and on the desktop. | #52, #55, #66 |
| M10 | WHEN a .rtf file is opened, THE APP SHALL read and write it through the same model and scanner (M3, D11). | Sampled real .rtf files open; unsupported features are flagged. | Corpus sample test plus fixtures. | #60, #61, #62, #63 (tracker #23) |
| M11 | WHEN a .md or .txt file is clicked in Files, THE APP SHALL open it in NeoCraft, except files in folders on the excluded list (the owner's agent and wiki folders, configurable in the admin setting), which still open in Nextcloud Text (M3, D4, D11). | Excluded-folder pages open in Text; others in NeoCraft. | Click one file in and one outside an excluded folder. | #64, #66 |
| M12 | THE NEXTCLOUD "+ New" MENU SHALL offer *New document (.docx)* and *New note (.md)*, and never overwrite an existing file (M3, D13). | Both entries create valid minimal files. | Create each in a folder that already holds a file of that name. | #65, #67 |
| M13 | WHEN md, txt or rtf is double-clicked on the desktop, THE APP SHALL open it in Document mode on Windows, macOS and SteamOS; .docx stays with WordCraft (M4, D15). | The OS opens NeoCraft for md/txt/rtf and WordCraft for docx. | Double-click each type on each OS. | #70, #71, #72, #73 (tracker #25) |
| M14 | WHEN *Launch external* is pressed in the browser, THE APP SHALL open the file in the desktop app (local copy when synced, a WebDAV cache with If-Match when not), turn the browser tab read-only, and use only the server's Tailscale HTTPS name in every link it writes (M4, D10, D12, D16). | The golden task works for synced and unsynced files. | The golden task (ROADMAP.md) on Windows, SteamOS and macOS. | #74, #75, #76, #77, #78 (tracker #26) |
| M15 | Books keep working as upstream built them, and the review's save-safety bugs are fixed before any default-handler cutover (D5; review gate R0). | Upstream's book tests pass; #9-#15 are closed with regression tests. | `npm test` plus each bug's failure-injection test. | #9, #37-#40 (tracker #10), #11, #12, #13, #41 then #14, #42-#44 (tracker #15) |
| M16 | AFTER a real week of use with every friction point filed, the Collabora config is backed up, its reinstall recipe recorded, and only then are `richdocuments` and the Collabora container uninstalled; the complex-docx fallback becomes *Launch in WordCraft* (M5, D6). | The week's issues are filed; the backup and recipe exist; Collabora is gone and complex files open in WordCraft. | The owner's checklist in the M5 issue; the golden task's recorded evidence. | #31 |
| M17 | WHEN I choose **Report a bug**, in the Nextcloud browser editor or in the desktop app, THE APP SHALL open the shared report form (craft-bugreport-web): what happened, what I expected, the app's recent errors, an optional screenshot and, only if I tick it that time, the open document sent as is; it SHALL show me every file and send the report to the bug File Drop only after I press Send. The drop address and token come from the server config (browser) or the app's settings (desktop), never from the source. | A report sent from each lands in the File Drop with the desktop launcher's layout, and the bug intake reads it unchanged. | Browser: in the disposable Nextcloud with the drop config set, make a report, check the consent screen, press Send, see the zip in the drop. Desktop: the same from a CI build on one OS, with the drop set in Settings. | #83, #84, #85 |
| M18 | WHEN a new signed release of the NeoCraft Nextcloud app (`neocraft`) is published to our merged app-store feed (the app-store repo (private)), THE NEXTCLOUD ADMIN PANEL SHALL offer it on the Apps page and the scheduled job SHALL install it automatically. Desktop builds are unchanged: they update from this repo's releases (D8). | Publishing a new version makes the Apps page offer it, and within the hour the server runs it; nothing is copied by hand, and the official apps still update. | On the test Nextcloud (nc-projects-test, never the live server) with the app-store repo (private)'s merged feed: publish a test release, see it offered on the Apps page, wait for the scheduled job, and check `occ app:list` shows the new version; then the same with a second version. | #86, #87, #88 |

## Automation (after 1.0, built before 1.1)

Added 2026-11-03, my decision (ROADMAP.md, M8). It is not part of the 1.0 definition above, and 1.1 and 1.2 are unchanged. Desktop only (Windows, macOS, SteamOS): the browser editor and NEO Pocket get no automation (ROADMAP.md, M8, says why). Every issue carries the `after-1.0` label.

| # | Must | Done looks like | Check | Issues |
|---|---|---|---|---|
| N18 | THE APP SHALL answer one set of automation methods (books, chapters, read, append, replace, add, counts and goals, search, export, snapshot, documents, state, screenshot) either headless, in its own main process with no visible window, or attached to the running app through a key-guarded local socket that is off until I turn it on; headless SHALL refuse my real library while the app is open. | The same steps give the same library and the same exported file headless and attached; with automation off, nothing listens. | Automation tests on a temporary library (headless), plus the same steps against a running app. | #196, #197 |
| N19 | WHEN NeoCraft is started with a subcommand (`books`, `chapters`, `read`, `append`, `replace`, `counts`, `search`, `export`, `text`, `inspect`, `run`, `mcp`), THE APP SHALL do that job with no window and print the result; with no subcommand it SHALL open exactly as today. | Each subcommand works as a process on a machine with no display; files on the command line still open in Document mode. | Process tests per subcommand; the existing `open-args` tests pass unchanged. | #198 |
| N20 | WHEN `neocraft mcp` runs, THE APP SHALL serve the automation methods as MCP tools over stdio, headless by default and attached with `--attach`, writing only inside the library and the folders it is given. | An agent completes 10 real writing tasks through it with no window, and the same 10 attached. | MCP process test with the 10 tasks. | #199 |
| N21 | THE APP SHALL run a script file (one method per line, `#` comments), headless (`neocraft run`) or in the window (File > Run Script...), check every line before running any, stop at the first failing line and name it, and first take a snapshot of each book it names, so restoring that snapshot undoes the whole run. | The same script gives the same library headless and in the window; a script whose line 3 does not parse reports `line 3` and changes nothing; restoring the snapshot after a run gives the library back as it was. | Script tests headless and in the window. | #200 |

## 1.1: Modes

A release right after 1.0 (ROADMAP.md, M6), keeping NEO's look and design. It is not part of the 1.0 definition above; 1.0 ships and is used for its real week first. Its issues carry the `after-1.0` label. Same table format as the Musts above.

| # | Must | Done looks like | Check | Issues |
|---|---|---|---|---|
| N1 | THE APP SHALL show a mode switch, a segmented control at the top center of the bar (Books, Scripts, Notes) styled like NEO's toolbar, and SHALL remember the last mode; a magnifier for Search sits at the right of the same bar. | Switching modes keeps unsaved text safe; the last mode comes back after a restart or reload. | Switch modes with unsaved text; restart; check the mode. | #140 |
| N2 | WHEN Notes mode is open, THE APP SHALL show a library of .md note files with a side list, and edit a note in the same editor as 1.0's Document mode, byte-faithfully (M4). | Create, edit, rename and delete notes; an unedited note saves byte-identical. | Temporary-folder test plus the Markdown corpus byte test through the Notes editor. | #141 |
| N3 | WHEN any single file (.docx, .rtf, .txt or .md) is opened from Nextcloud, THE APP SHALL open it in the Notes editor; the spec's Document mode is the Notes editor. | All four types land in Notes, with the 1.0 fidelity warning and guarded saves unchanged. | Open each type in the browser and on the desktop. | #142 |
| N4 | WHEN the session clock is running and the timestamp key is pressed, THE APP SHALL insert the elapsed time as `[mm:ss]` at the cursor. | `[01:15]` at 75 s; one undo step. | Formatter tests plus a manual check. | #143 |
| N5 | THE APP SHALL store scripts as Fountain plain text (.fountain), and the two-column video-essay script (narration beside visuals and clips, with timings) SHALL be built first, using a small documented Fountain extension. | A two-column script re-opens identical and reads cleanly in a plain text editor. | Round-trip byte test; the format spec in `docs/` matches the tests. | #144, #145 |
| N6 | THE APP SHALL offer a podcast or audio script type (speakers, lines, music and segment cues) in Scripts mode. | A podcast script round-trips and cues are distinct from spoken lines. | Round-trip test; manual check of cues. | #146 |
| N7 | THE APP SHALL offer a screenplay type in Scripts mode that is standard Fountain. | Existing screenplay fixtures parse and save byte-identical. | Fixture round trip. | #144 |
| N8 | WHEN a two-column script is exported to .docx, THE APP SHALL write a two-column table for collaborators. | The export opens in WordCraft as a two-column table. | Unzip test plus open in WordCraft. | #147 |
| N9 | WHEN the owner searches, THE APP SHALL search across everything NeoCraft holds (books, scripts, notes and documents opened from Nextcloud, not all of Nextcloud), with filters by mode, in the desktop app and in the browser editor. | A phrase in each kind is found; the mode filter narrows results. | Index tests; manual search in both places. | #148, #149 |
| N10 | THE APP SHALL show word count and goals in Notes and Scripts, and a Pomodoro timer in the toolbar style (default 25 work, 5 break, 15 after every 4, adjustable) that tracks session word count and words per Pomodoro, with a simple history view. | Timer state-machine tests pass; history survives a restart. | Fake-clock tests; manual run of one cycle. | #150, #151 |
| N11 | WHEN typewriter mode starts, THE APP SHALL cover only its own window in the browser, and in the desktop app SHALL cover every display other than the typing one with a borderless dim grey window; any key or click on a cover returns focus. | The second display is dimmed on Windows, macOS and SteamOS; hot-plugging works. | Display-plan tests; manual check with two displays on each OS. | #152, #153 |

## 1.2: Desk, Script to cut, Time River

Added 2026-11-01 by the owner in a Project Manager session (three bold proposals; owner: "All three (Recommended)", Time River "After 1.0 (Recommended)"). A release after 1.1 (ROADMAP.md, M7). 1.0 and 1.1 are unchanged: M8 still saves a copy plus a notice in 1.0, and N17 adds the merge view on top later. Every issue carries the `after-1.0` label.

| # | Must | Done looks like | Check | Issues |
|---|---|---|---|---|
| N12 | THE NEOCRAFT NEXTCLOUD APP SHALL have its own **Desk** page in the Nextcloud top bar that shows each folder the owner picks as a labelled shelf and each .md, .txt, .rtf, .docx and .fountain file in it as a cover (NEO's seeded cover art, title, word count); clicking a cover opens it in the editor, and excluded folders (M11) never appear. | Two picked folders show as two shelves; a new file shows up on reload; a cover opens the file. | In the disposable Nextcloud 33: pick folders, add a file, reload, open a cover; an excluded folder stays hidden. | #160: #156, #157, #158 |
| N13 | WHEN the desktop app or NEO Pocket points at a Nextcloud-synced folder, THE APP SHALL show the same Desk from the local copy, with no network call. | The desktop and Pocket show the same shelves as the browser for one folder. | One synced folder on Windows, macOS, SteamOS and Pocket. | #159 |
| N14 | WHEN a two-column script is open, THE APP SHALL show a runtime for every narration block and a running total from the owner's measured reading speed, and SHALL offer a teleprompter that scrolls only the narration at that pace, on another display on the desktop or in its own window in the browser. | Calibrate once by reading a block aloud; runtimes update as you type; the teleprompter keeps pace and can pause and mirror. | Pure runtime tests with fixed inputs; manual run on two displays. | #165: #161, #162 |
| N15 | WHEN **Send to FilmCraft** is chosen on the desktop, THE APP SHALL write a rough-cut plan from the two-column script (a named marker per block, an empty labelled clip slot per visuals cell, narration text per block with its runtime) and open it in FilmCraft as a new sequence with a scratch narration track. | FilmCraft opens a sequence whose markers and slots match the script, in order and with the runtimes. | Plan unit tests; the FilmCraft import test (FilmCraft issue iannitram/filmcraft#112); manual run on one OS. | #163, #164, iannitram/filmcraft#112 |
| N16 | THE APP SHALL show a **Time River** slider for a document that steps through every Nextcloud version and local autosave of it, showing removed paragraphs as ghosts and added ones highlighted, and SHALL restore a single paragraph from any point as one undo step. | Scrubbing shows each saved state; restoring one paragraph changes only that paragraph. | Diff unit tests; in the disposable Nextcloud: edit across several pauses, scrub, restore. | #170: #167, #166, #168 |
| N17 | WHEN a save finds the file changed on the server (M8), THE APP SHALL still save the copy and then open a side-by-side merge view with *keep mine*, *keep theirs* or *both* per changed paragraph. | Two-tab conflict: the copy exists, the merge view opens, and the merged result saves as a normal guarded save. | The M8 two-tab test extended with a merge. | #169 |

## Won'ts

- No chapters, library or covers in Document mode (D2).
- No table editor and no complex .docx layout: those files go to the fallback (Risks; D3).
- No sync engine of its own: the Nextcloud desktop client syncs (D7).
- No collaborative editing and no public-share editing (review roadmap, deferred work).
- No signed or notarized builds: Gatekeeper and SmartScreen warnings are accepted (D8).
- No bare LAN hostnames or plain `http://` addresses in any link it writes (D16).
- No docx desktop default: WordCraft keeps .docx on the desktop (D15).

## Problem

Nextcloud Files opens documents in Collabora, a heavy office suite, for files that are mostly writing: Markdown notes, plain text, RTF and simple Word documents. On the desktop the same files open in different apps.

## Solution

One writing app in both places: NeoCraft opens these files from Nextcloud Files in the browser and from the desktop, saves them back in their own format without damaging what it cannot edit, and hands complex documents to WordCraft.

## Implementation decisions

D1-D16 in ROADMAP.md hold. In short: NeoCraft is the writing app and WordCraft the heavy docx editor (D1); our code lives in new files with small `// NEOCRAFT:` hooks into upstream's `app.js` and `main.js`, and upstream is merged monthly (D5); tracking is this repo's issues plus a Software Depot entry (D9); links use the Tailscale HTTPS name only (D16). The architecture (an editor/document session port and a storage-host port, a Nextcloud PHP app `neocraft`) is in [docs/review-2026-10-24/NEXTCLOUD-PLAN.md](docs/review-2026-10-24/NEXTCLOUD-PLAN.md).

Added 2026-10-28 (design review):

- **Document mode is built as the 1.1 Notes editor**, so 1.1 does not redo it. 1.0 may keep the name Document mode in its UI; 1.1 renames it Notes.
- **Scripts are stored as Fountain plain text (.fountain).** Two-column and podcast types use Fountain conventions plus a small documented extension, readable in any text editor.
- **The mode switch design is settled now, though it ships in 1.1:** a segmented control at the top center (Books, Scripts, Notes), styled like NEO's toolbar, remembering the last mode, with Search as a magnifier at the right of the same bar. Search covers what NeoCraft holds, not all of Nextcloud.
- **1.0 is unchanged.** Re-confirmed in the review: build order browser first (D14), monthly upstream merges (D5), desktop defaults (M13), Launch external stays in 1.0 (M14), the "+ New" menu stays .docx and .md only (M12), conflicts save a copy and notify (M8), and desktop builds stay unsigned.

## Platforms (R04)

Desktop on Windows, macOS (arm64 and x64) and Linux (SteamOS, AppImage). Browser editor inside Nextcloud 33. Per-OS details: the Nextcloud client config paths and macOS File Provider placeholders (ROADMAP.md, M4); Linux needs a `.desktop` entry for `neocraft://` (installed by the launcher).

## Milestones to build stages

| Approved milestone (ROADMAP.md) | Build stage and gate (review roadmap) |
|---|---|
| M0 Make it ours | R0 release isolation and safety foundation |
| M2 spike | R1 Nextcloud integration spike (before format work, per D14 "browser button first") |
| M1 Document mode | R2 document core, TXT, Markdown; R3 simple DOCX |
| M2 The Nextcloud button | R3 guarded browser saves |
| M3 The rest of the browser | R4 RTF, Files integration, "+ New" |
| M4 Desktop and Launch external | R5 desktop Document mode and external launch |
| M5 Cutover | R6 measured cutover |

## Testing decisions

Format adapters are pure reader/writer pairs with Node fixture tests. The Markdown no-edit byte test on a real-world corpus is the gate, run on every build. Nextcloud work is tested in a disposable Nextcloud 33, never the live server. The golden task in ROADMAP.md is the stability check.

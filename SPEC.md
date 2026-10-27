# NeoCraft: spec

**Approval:** 2026-10-26, the owner, in the Project Manager session's question tool: "Approve, 1.0 = M5 (Recommended)". The spec is the decisions D1-D16 and milestones M0-M5 in [ROADMAP.md](ROADMAP.md), as written on 2026-10-23. A changed Must or Won't sets this back to "not yet".

Must M17 added 2026-10-26 by the owner: "This will all apply to Neo as well" (with the bug-report answers given for the Craft web apps the same day: "Yes, a 1.0 Must (Recommended)", "Launcher set, browser version (Recommended)", "Same File Drop (Recommended)", "One shared module repo (Recommended)").

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
| M7 | WHEN a simple .docx is clicked in Nextcloud Files, THE APP SHALL open it in NeoCraft under Nextcloud's own login and save edits back as a new Nextcloud version, autosaving after a typing pause and on close, not per keystroke (M2). | The file opens in NeoCraft; Nextcloud's version list gains one version per pause, not one per key. | In a disposable Nextcloud 33: click, edit, wait, check versions. | #17, #45, #56, #57, #58, #59, #66, #30 |
| M8 | WHEN a save finds the file changed on the server, THE APP SHALL save the edits as a copy and say so, never overwrite (D12). | Two tabs on one file never overwrite each other; a 412 produces a copy plus a notice. | Two-tab conflict test against the disposable server. | #56, #57, #58 (tracker #22) |
| M9 | WHEN the fidelity scanner flags a file, THE APP SHALL offer *Open in Collabora* (browser, while installed) or *Launch in WordCraft* (desktop), *Save my edits as a copy*, or *Cancel* (D3, D6). | A complex .docx routes to the fallback; nothing is silently overwritten. | Open the table fixture in the browser and on the desktop. | #52, #55, #66 |
| M10 | WHEN a .rtf file is opened, THE APP SHALL read and write it through the same model and scanner (M3, D11). | Sampled real .rtf files open; unsupported features are flagged. | Corpus sample test plus fixtures. | #60, #61, #62, #63 (tracker #23) |
| M11 | WHEN a .md or .txt file is clicked in Files, THE APP SHALL open it in NeoCraft, except files in folders on the excluded list, which still open in Nextcloud Text (M3, D4, D11). | Excluded-folder pages open in Text; others in NeoCraft. | Click one file in and one outside an excluded folder. | #64, #66 |
| M12 | THE NEXTCLOUD "+ New" MENU SHALL offer *New document (.docx)* and *New note (.md)*, and never overwrite an existing file (M3, D13). | Both entries create valid minimal files. | Create each in a folder that already holds a file of that name. | #65, #67 |
| M13 | WHEN md, txt or rtf is double-clicked on the desktop, THE APP SHALL open it in Document mode on Windows, macOS and SteamOS; .docx stays with WordCraft (M4, D15). | The OS opens NeoCraft for md/txt/rtf and WordCraft for docx. | Double-click each type on each OS. | #70, #71, #72, #73 (tracker #25) |
| M14 | WHEN *Launch external* is pressed in the browser, THE APP SHALL open the file in the desktop app (local copy when synced, a WebDAV cache with If-Match when not), turn the browser tab read-only, and use only the server's Tailscale HTTPS name in every link it writes (M4, D10, D12, D16). | The golden task works for synced and unsynced files. | The golden task (ROADMAP.md) on Windows, SteamOS and macOS. | #74, #75, #76, #77, #78 (tracker #26) |
| M15 | Books keep working as upstream built them, and the review's save-safety bugs are fixed before any default-handler cutover (D5; review gate R0). | Upstream's book tests pass; #9-#15 are closed with regression tests. | `npm test` plus each bug's failure-injection test. | #9, #37-#40 (tracker #10), #11, #12, #13, #41 then #14, #42-#44 (tracker #15) |
| M16 | AFTER a real week of use with every friction point filed, the Collabora config is backed up, its reinstall recipe recorded, and only then are `richdocuments` and the Collabora container uninstalled; the complex-docx fallback becomes *Launch in WordCraft* (M5, D6). | The week's issues are filed; the backup and recipe exist; Collabora is gone and complex files open in WordCraft. | The owner's checklist in the M5 issue; the golden task's recorded evidence. | #31 |
| M17 | WHEN I choose **Report a bug**, in the Nextcloud browser editor or in the desktop app, THE APP SHALL open the shared report form (craft-bugreport-web): what happened, what I expected, the app's recent errors, an optional screenshot and, only if I tick it that time, the open document sent as is; it SHALL show me every file and send the report to the bug File Drop only after I press Send. The drop address and token come from the server config (browser) or the app's settings (desktop), never from the source. | A report sent from each lands in the File Drop with the desktop launcher's layout, and the bug intake reads it unchanged. | Browser: in the disposable Nextcloud with the drop config set, make a report, check the consent screen, press Send, see the zip in the drop. Desktop: the same from a CI build on one OS, with the drop set in Settings. | #83, #84, #85 |

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

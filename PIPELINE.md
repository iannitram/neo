Stage: Dev Loop
Since: 2026-10-26
Kind: fork (upstream: hughhowey/neo)
Spec: SPEC.md   Roadmap: ROADMAP.md (M0-M5; build stages R0-R6 in docs/review-2026-10-24/ROADMAP.md)   Code map: docs/review-2026-10-24/CODE-MAP.md
Platforms: mac, windows, linux (desktop builds) + the Nextcloud browser editor
Notes: Agent rules for our pipeline: AGENTS.fork.md (upstream owns AGENTS.md). Spec approved 2026-10-26 (D1-D16 + M0-M5, 1.0 = M5 cutover). Build order follows the review gates: R0 (#8, #16, bugs #9-#15) and the R1 spike #17 first. Hard issues split 2026-10-26 (RUBRIC): #18 and #20-#26 are trackers over children #32-#78 (#10 and #15 closed once their children were done), #2-#7 are milestone trackers, #28 the job queue; #14 and #17 stay Hard, with the Easy pieces #41 and #45 pulled out and merged. #31 (cutover) needs the owner's device and his yes before Collabora is removed. Added since: #79 (Document mode typing), #80-#82 (after 1.0), #83-#85 (M17 Report a bug; craft-bugreport-web #13 is closed, so #83 is ready) and #86-#88 (M18 admin-panel updates; #86 is merged). Status 2026-11-12: the pure, test-locked pieces are on main (fork identity and PR CI, the save fixes for books except #14, the document-session core, the .docx and .rtf readers, scanners and writers, the Markdown helpers, the guarded DAV save and conflict-copy helpers, the Tailscale origin rules, the desktop document host and its `neo.document` bridge); no page calls them yet, because Document mode (#36) is not started and the Nextcloud app is the empty scaffold (spike #17 open). The Software Depot entry (M0, D9) lives outside this repo. 2026-11-01: 1.2 (the Desk, Script to cut, Time River) added after 1.1: SPEC N12-N17, ROADMAP M7, trackers #160, #165, #170. 2026-11-03: Automation (command line, MCP server, scripts) added as M8, after 1.0 and before 1.1: SPEC N18-N21, issues #196-#200 (label after-1.0).

Design review 2026-10-28: 1.0 unchanged; 1.1 modes release added (ROADMAP M6, SPEC N1-N11, issues #140-#153, label after-1.0).

Stages: Proposal -> Spec -> Roadmap -> Dev Loop -> Prototype / Beta.
What each stage means and who moves a project: PIPELINE.md in the owner's private pipeline repo.
The Project Manager updates this file when the stage changes and adds a CHANGELOG line.

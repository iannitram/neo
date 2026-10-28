Stage: Dev Loop
Since: 2026-10-26
Kind: fork (upstream: hughhowey/neo)
Spec: SPEC.md   Roadmap: ROADMAP.md (M0-M5; build stages R0-R6 in docs/review-2026-10-24/ROADMAP.md)   Code map: docs/review-2026-10-24/CODE-MAP.md
Platforms: mac, windows, linux (desktop builds) + the Nextcloud browser editor
Notes: Agent rules for our pipeline: AGENTS.fork.md (upstream owns AGENTS.md). Spec approved 2026-10-26 (D1-D16 + M0-M5, 1.0 = M5 cutover). Build order follows the review gates: R0 (#8, #16, bugs #9-#15) and the R1 spike #17 first. No code skeleton: #17 picks the Nextcloud API and #18 designs the session and host interfaces; the code map names every planned module. Hard issues split 2026-10-26 (RUBRIC): #10, #15, #18, #20-#26 are now trackers over children #32-#78 (23 Easy with Qwen briefs, 22 Medium, 2 Hard); #14 and #17 stay Hard with Easy pieces #41 and #45 pulled out; #2-#7 are milestone trackers, #28 the job queue. #31 (cutover) needs the owner's device and his yes before Collabora is removed. Added since: #79 (Document mode typing), #80-#82 (after 1.0), #83-#85 (M17 Report a bug; #83 Easy, waits on craft-bugreport-web #13) and #86-#88 (M18 admin-panel updates; #86 Easy with tests). Merged from the 1.0 plan by 2026-10-28: #8 (fork identity), #46 (frontmatter), #57 (conflict copies), #75 (handoff intents), #96 (e2e fixtures), #37 (meta-merge), #42 (flush barrier), #38 (library merge); these modules exist with locked tests but most are not yet called from the app; the open PR #89 is the R0 fix for #12. The Software Depot entry (M0, D9) lives outside this repo.

Stages: Proposal -> Spec -> Roadmap -> Dev Loop -> Prototype / Beta.
What each stage means and who moves a project: PIPELINE.md in the owner's private pipeline repo.
The Project Manager updates this file when the stage changes and adds a CHANGELOG line.

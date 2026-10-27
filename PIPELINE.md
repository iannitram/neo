Stage: Dev Loop
Since: 2026-10-26
Kind: fork (upstream: hughhowey/neo)
Spec: SPEC.md   Roadmap: ROADMAP.md (M0-M5; build stages R0-R6 in docs/review-2026-10-24/ROADMAP.md)   Code map: docs/review-2026-10-24/CODE-MAP.md
Platforms: mac, windows, linux (desktop builds) + the Nextcloud browser editor
Notes: Agent rules for our pipeline: AGENTS.fork.md (upstream owns AGENTS.md). Spec approved 2026-10-26 (D1-D16 + M0-M5, 1.0 = M5 cutover). Build order follows the review gates: R0 (#8, #16, bugs #9-#15) and the R1 spike #17 first. No code skeleton: #17 picks the Nextcloud API and #18 designs the session and host interfaces; the code map names every planned module. Issues #8-#26, #30, #31 are sized; #2-#7 are milestone trackers, #28 the job queue. #31 (cutover) needs the owner's device and his yes before Collabora is removed. The Software Depot entry (M0, D9) lives outside this repo.

Stages: Proposal -> Spec -> Roadmap -> Dev Loop -> Prototype / Beta.
What each stage means and who moves a project: PIPELINE.md in the owner's private pipeline repo.
The Project Manager updates this file when the stage changes and adds a CHANGELOG line.

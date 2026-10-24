# NeoCraft — revised roadmap

Updated 2026-10-24 from the code review of `3f21d090662cbcbd441d5207292e2c175ee1a01a` (NEO 1.6.0).

NeoCraft adds a safe single-document editor and Nextcloud integration alongside NEO's existing plain-file book workflow. It edits md/txt/rtf/simple docx; WordCraft remains the full desktop DOCX editor. This revision preserves the prior roadmap's D1–D16 product decisions. The complete original is [archived here](ROADMAP.previous.md); the [conversion plan](NEXTCLOUD-PLAN.md) specifies implementation contracts and justified sequencing corrections.

## Current state

| Capability | Evidence / status |
|---|---|
| Desktop book editor, outlines, snapshots, manuscript/PDF/export | Implemented in upstream-derived code; save-safety issues remain |
| Pocket Android/iOS host | Implemented; native runtime not validated in this review |
| NeoCraft identity / independent updates | Not implemented; current configuration still targets upstream |
| Document mode / source-preserving adapters | Not implemented |
| Nextcloud PHP app / Files integration / DAV conditional saves | Not implemented |
| External launch, remote cache, WordCraft fallback | Not implemented |

Progress requires acceptance evidence. Planned work below is not marked complete merely because the original editor contains related functions.

## R0 — release isolation and safety foundation

- Separate NeoCraft product/app ID, userData, default library, protocols and fork release/update URLs. Preserve MIT credits. Keep migration explicit; never automatically move the original NEO library.
- Adapt unsigned fork CI for Windows NSIS/portable, macOS arm64/x64 and Linux AppImage, including smoke-test process names and library paths. Run unit tests/lint on PRs; use locked dependencies.
- Fix [B02–B08](BUG-REPORT.md): exact revision conflict checks, metadata and notes preservation, failed sheet-save retry, verified snapshot retention, Pocket replacement and close barriers. Each fix gets a failure-injection regression appropriate to its path.
- Establish a representative, permissioned document corpus and restore procedure. Add the planned Depot entry when that repository is available; its absence must not be represented as completed.

**Gate:** fork and NEO coexist without sharing settings/update channels; tested save failures preserve both versions; snapshot recovery verified; required CI passes. No default-handler cutover before this gate.

## R1 — Nextcloud integration spike

Confirm actual target Nextcloud/Text/richdocuments versions. In a disposable matching server, ship a minimal authenticated app with an explicit Edit with NeoCraft action for txt. Prove Files/Viewer APIs, permissions, reverse-proxy/subdirectory URLs, MIME precedence and Text/Collabora fallback. Retain existing defaults.

**Gate:** evidence note with exact supported APIs, a successful disposable-file edit and denied unauthorized access. Estimate 2–4 days after a test instance is available; no guaranteed half-day assumption.

## R2 — Document core, TXT and Markdown

Add a separate document bootstrap/session and host interfaces; reuse extracted editor behavior with small `NEOCRAFT:` hooks. Exclude book-only commands. Implement accurate dirty/saving/error state, serialized revisioned saves, recovery drafts and navigation handling. Preserve encoding/BOM/newlines for TXT. Preserve frontmatter, wikilinks and untouched source spans for Markdown; provide source editing where rich editing cannot preserve syntax.

**Gate:** 50 real Markdown files are byte-identical after no-op save; localized edit tests preserve untouched spans; TXT encoding/newline fixtures pass; failed saves/reloads retain edits. Opt-in TXT/MD preview can ship here without taking over Nextcloud Text.

## R3 — simple DOCX and guarded browser saves

Implement a namespace-aware OOXML reader, safe limited writer and fail-closed fidelity scanner. Preserve package relationships/IDs; replacing document.xml wholesale is not an accepted fidelity strategy. Implement same-origin authenticated DAV with ETags, If-Match and exclusive conflict-copy creation. Handle lost acknowledgements, permission loss, deletion and locks.

**Gate:** simple DOCX edits reopen correctly in WordCraft and an independent office application; unsupported fixtures block overwrite and offer fallback/copy; two-tab conflict tests preserve both versions; all P1 review issues affecting shipping paths are closed. Then make NeoCraft an opt-in/default handler for the tested subset while Collabora remains installed.

## R4 — RTF, remaining Files integration and creation

Add bounded RTF parser/writer and fidelity detection, using the real corpus to define its subset. Register docx/rtf/md/txt handlers through verified APIs, preserve excluded-folder delegation to Text, and add New document (.docx) / New note (.md). Complete accessibility, browser packaging, compatibility/security tests and app upgrade/disable instructions.

**Gate:** all four supported types round-trip under their declared contract; exclusions and complex-file fallback work; new file creation cannot overwrite existing files; install/upgrade/disable pass on the supported Nextcloud/PHP matrix.

## R5 — desktop Document mode and external launch

Use the same formats/session model on Electron. Associate md/txt/rtf; leave docx defaults with WordCraft. Validate enrolled canonical Tailscale HTTPS origins and account-specific sync mappings. Add placeholder-safe local open and conditional DAV cached editing for unsynced files using Login Flow v2 and secure credential storage.

Handoff must flush browser edits and receive desktop acknowledgement; a custom protocol launch alone is not proof of success. Provide cancellation/resume for missing desktop app, offline devices and failed uploads. ETag checks remain mandatory even with handoff.

**Gate:** golden task succeeds on Windows, macOS and SteamOS, for synced and unsynced files, plus stale ETag, selective sync, multiple accounts and launch-failure cases.

## R6 — measured cutover

Use the app for at least one real week, record incidents and verify a backup restore. Require zero unresolved P1 issues and working complex-document fallback on every device before proposing removal of richdocuments/Collabora. Preserve configuration and rehearse reinstall. Removal/deployment is a separate operational action; this review does not perform it. Update Depot stability using recorded golden-task evidence.

**Golden task:** open a real simple DOCX from Files → edit → save → launch desktop → edit/save → reopen in browser and verify; then no-op-save a Markdown file with frontmatter and compare bytes. Also repeat with an external conflicting edit and confirm both copies survive.

## Ongoing and deferred work

Merge upstream monthly on a branch; run book, document, integration and format-corpus regressions before accepting the merge. Keep fork hooks small and maintain the code map. Offer generally useful changes upstream selectively. Defer collaborative editing, complex table/DOCX layout, a custom sync engine and public-share editing until the single-user persistence and fidelity contracts are proven.

Work estimates and dependencies are in the conversion plan. Handler discovery can proceed early; making NeoCraft the default is gated by persistence and fidelity, not by a calendar date.

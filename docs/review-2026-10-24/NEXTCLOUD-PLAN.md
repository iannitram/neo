# NeoCraft → Nextcloud app conversion plan

Baseline: iannitram/neo `3f21d090662cbcbd441d5207292e2c175ee1a01a`, 2026-10-24. This is an implementation plan; no Nextcloud app has been built or deployed by this review. Read BUG-REPORT.md and the revised ROADMAP.md proposal in this folder together with this document.

## Product constraints carried forward

Retain the existing roadmap's D1–D16 decisions: NeoCraft handles writing and simple documents; WordCraft handles complex desktop DOCX. Books continue as plain-file books. Browser targets docx/rtf/md/txt, excluded Markdown folders stay in Nextcloud Text, desktop defaults are md/txt/rtf, and docx stays with WordCraft. Unsupported document features require fallback or save-as-copy. Track upstream with small marked hooks. Use the Nextcloud desktop client for normal sync. External launch must support both synced paths and a guarded WebDAV cache. Generated/stored server URLs use the owner's Tailscale HTTPS canonical origin. Old HTTP/LAN addresses are incoming lookup aliases only.

The prior roadmap says Nextcloud 33, richdocuments 10.3.2 and Text 7.0.1. Confirm those installed versions before choosing APIs. A server accessible only over Tailscale also requires an active tailnet connection on every browser/desktop device.

## Architecture decision

Build a conventional Nextcloud PHP app (`neocraft`) with a separately bootstrapped Document editor. Reuse editor behavior through extracted modules; do not load the entire book application behind a fake library bridge. `app.js` assumes shelves, book metadata, chapter structure, menus and background library refresh at startup. Pocket proves host portability, but is not a drop-in single-file editor.

Keep two explicit ports:

1. **Editor/document session:** bytes + format adapter + edit model + dirty revision + capabilities. Knows nothing of Nextcloud filesystem paths, Electron IPC or credentials.
2. **Storage host:** open by authorized file ID, read bytes/ETag, conditional save, create copy, export and close/handoff. Implement browser/Nextcloud and Electron adapters. Keep the existing `window.neo` book API for book mode; do not implement dozens of misleading no-op methods for Document mode.

Suggested structure (all new):

```
editor/                     extracted editing behavior, commands, selection
 document-session.js        immutable loaded revision, dirty state, recovery
formats/                    txt, markdown, docx, later rtf adapters and fixtures
hosts/nextcloud.js           browser session/conditional save/copy/navigation
hosts/electron-document.js  native open/save/recovery/local conflict checks
nextcloud/neocraft/
 appinfo/info.xml           ID, compatibility, license, dependencies
 appinfo/routes.php         page/session/copy/handoff routes
 lib/AppInfo/Application.php
 lib/Controller/            authenticated page + authorized file operations
 lib/Service/               file access, conflict copy, capability responses
 templates/editor.php      CSP-compatible boot data and entrypoint
 src/files-action.js        Files/Viewer and creation menu integration
 js/ css/                  reproducibly built distributable assets
 tests/                    PHP permission tests + browser integration
```

Use Nextcloud's supported app scaffold, autoloading and frontend tooling for the chosen release. “No build step” describes upstream NEO; it need not constrain integration packaging. Do not put Node `main.js`, user libraries, secrets or dev dependencies into the web app distribution.

## Phase A — prove integration before expensive format work

Use a disposable Nextcloud instance matching the target release. Install NeoCraft alongside Text and richdocuments without changing their defaults. Spike the documented Files action API, Viewer provider registration, MIME mappings, app navigation, file IDs, new-file menu and default-handler precedence. Verify behavior from Files, search, recent files, shared folders and renamed/moved files; add an explicit “Edit with NeoCraft” action first.

Produce an evidence note recording exact server/app versions, supported API imports, handler priorities, exclusion-folder behavior and the fallback route to richdocuments/Text. Do not guess a private richdocuments URL or handler order. Prefer native Nextcloud app navigation; use an iframe only if the spike proves it necessary, with explicit frame/CSP constraints and an origin-checked messaging contract.

**Exit:** an authenticated user can open a disposable txt file in a minimal editor, an unauthorized user cannot access it, and selecting NeoCraft does not disrupt fallback editors. This is a technical spike; it does not replace the original browser-first delivery goal.

## Phase B — establish the document and persistence contracts

A session captures `{ fileId, format, originalBytes, baseRevision, generation, model, capabilities, fidelityReport }`. Host callbacks return immutable results belonging to that session, never whatever document is globally current when a promise resolves. Serialize saves per session. Record `savedGeneration` only for the version actually acknowledged; edits made during an in-flight save remain dirty. Ignore stale open/read responses after navigation.

State transitions: loading → clean → dirty → saving → clean/dirty; failures lead to retryable error, conflict, permission-lost or offline. Show a small persistent state indicator. Never claim success before acknowledgement. Keep a recoverable local draft during editing; namespace storage by account, server and file ID, handle quota failure, and clear or offer removal on logout. Decide retention/encryption with the owner before caching sensitive documents; do not assume localStorage is a durable document store.

Closing a browser cannot await a PUT reliably. Flush during normal editing and visibility changes, keep the draft, and use a dirty-close warning when necessary. Electron should use an acknowledged close barrier. Books need B02–B08 fixes independently; do not transplant their current persistence semantics.

**Exit:** injected network failures, stale responses, save/navigation races and reload preserve the user's edits and report accurate dirty state.

## Phase C — implement safe file access and conditional writes

Resolve file IDs through Nextcloud's current user's filesystem API and check read/update/create permissions on every operation, not just on opening the page. Treat file IDs as identifiers, not permission grants. Support mounted/shared storage and moves; validate destination names and permissions for copies. Reject cross-account IDs, traversal, absent files, folders and unsupported MIME/extension mismatches. Start with authenticated sessions only; public share editing is a separate feature.

For browser byte transport, prefer same-origin WebDAV with the logged-in session and required Nextcloud request token. Use Nextcloud's URL helpers so subdirectory/reverse-proxy installs work. Read a stable version (GET with its ETag); save with the exact quoted opaque ETag in `If-Match`. A PHP save endpoint is an alternative only if it enforces an equivalent atomic compare-and-write under the appropriate lock: a separate GET/check followed by an unconditional write is unsafe.

- Successful PUT: capture the returned revision or obtain a fresh consistent one; do not clear dirty state for subsequent edits.
- 412: stop autosave; retain local bytes; create a unique conflict copy with `If-None-Match: *` or an equivalent atomic create operation. Handle naming collisions and parent-folder create denial. Do not automatically retry over the changed original.
- 401/403: preserve draft and make the editor read-only; do not redirect away from unsaved writing.
- 404: handle deletion/move with recovery/export; do not recreate the original silently.
- 423: retain and retry with bounded backoff; do not unlock another editor's file.
- Timeout after upload: outcome is unknown; re-read/compare before retrying. A lost acknowledgement must not create endless conflict copies.

ETags prevent lost updates, not collaboration or exclusive editing. Nextcloud transactional file locks are not automatically a persistent editor lease. Verify actual version-history behavior on the target storage backend rather than assuming every PUT creates exactly one historical version.

**Exit:** two tabs submitting different edits from one base cannot overwrite each other, including write response loss, sharing revocation and external storage cases.

## Phase D — build formats around fidelity, not the current book importer

All adapters expose open/scan/serialize, a supported-feature manifest and source revision retention. Enforce file/ZIP/XML size limits and decompression limits. Disable XML external entities, reject dangerous links and embedded active content, and sanitize the resulting editor model/HTML. Run no document-provided scripts. Browser CSP should deny objects, arbitrary frames, forms and remote resources; keep scripts local and align worker/WASM allowances with the chosen Nextcloud CSP API.

| Format | Model / preservation strategy | Required acceptance fixtures |
|---|---|---|
| TXT | retain original bytes, BOM, newline style and chosen encoding; plain-text editing without automatic smart punctuation by default | UTF-8 with/without BOM, UTF-16, CRLF/LF/CR, mixed endings, no final newline, non-Latin text, malformed input |
| Markdown | source spans for untouched lines/blocks, exact frontmatter and newline retention; preserve unknown syntax and wikilinks; raw-source fallback | 50 owner-selected real files plus frontmatter, nested lists, code, tables, references, HTML, wikilinks and mixed endings; no-edit SHA-256 identical |
| Simple DOCX | namespace-aware OOXML parser; typed paragraph/run/list/link model; preserve untouched ZIP entries and relationships | headings, lists, links, styles, sections, Unicode, blank runs; open/edit/reopen in WordCraft/Word or LibreOffice; unknown features are flagged |
| RTF | maintained parser plus bounded writer and supported subset; preserve original if unsupported | Unicode `\\u`/fallback rules, codepages, escaped braces, nested groups, lists, fields, tables and objects; malformed input |

Unknown encodings cannot be reliably inferred in every case: ask for an encoding when ambiguous or refuse destructive save. “Byte-faithful Markdown” needs tests for localized edits, not only no-op save; a rich DOM serializer alone cannot meet it.

For DOCX, copying all ZIP entries then replacing `word/document.xml`'s body does **not** by itself preserve fidelity. Lists, hyperlink relationships, styles, section properties, fields, comments, bookmarks and drawings have references across parts. Patch only supported nodes and retain relevant IDs/relationships; otherwise deny overwrite. The scanner must fail closed for unknown elements, not just search for a small list of known unsupported features. Untouched unsupported files may download unchanged, but edited ones require a clearly named copy or fallback.

Complex-file options remain Open in Collabora, Launch WordCraft where available, save supported edits as a copy, or cancel. Existing import/export functions remain for books; they are not format-round-trip implementations.

## Phase E — Nextcloud UX and packaging

After format and conflict gates pass, add docx handling, then rtf/md/txt, with path exclusions explicitly verified. Add New document and New note via the supported creation API, using exclusive creation and valid minimal content. Keep fallback actions accessible even if NeoCraft becomes the default. Honor read-only shares, keyboard focus, screen reader labels and small screens. Avoid global upstream CSS affecting the Nextcloud shell; scope styles or isolate the editor document.

Package with metadata specifying only tested Nextcloud/PHP ranges. Add PHP lint/static checks, PHP authorization tests, JavaScript lint/unit tests and browser tests against the compatibility matrix. Include third-party notices, pinned assets, reproducible builds and an install/upgrade/disable procedure. Verify compatibility and licensing requirements against current Nextcloud App Store documentation before submission. Preserve upstream MIT attribution; choose the new app's license deliberately after checking bundled dependency obligations, including dictionaries.

## Phase F — desktop integration and external handoff

Complete fork identity isolation before distributing binaries. Add Document mode file opening via CLI, Windows/Linux associations and macOS open-file events. Local saves need a content revision and atomic replacement; mtime alone can miss changes. The Nextcloud client remains responsible for syncing the local folder. Local conflict checks cannot guarantee detection of a remote edit the client has not downloaded; prefer conditional DAV for stronger cross-device protection when required.

Treat `neocraft://` links as untrusted. Do not put app passwords or other credentials in the URL. Validate the canonical HTTPS Tailscale origin against an enrolled account, port and path; deny arbitrary hosts, encoded traversal and paths outside the mapped sync root. Aliases must be explicitly enrolled matches, not “all hosts with the same short name.” Honor reverse-proxy base paths. Parse Nextcloud client mappings per OS, account and selective-sync root; verify them rather than assuming config file locations/schema. File Provider placeholders require opening the chosen file, not scanning the library.

For an unsynced file use Login Flow v2 on the canonical origin, store its app password in the OS credential store, and retain a private cache plus base ETag. Require explicit handling if secure storage is unavailable. Upload with If-Match and the same conflict-copy policy as the browser. Never embed credentials in a synced folder or log. Enforce network timeouts and safe redirect behavior.

External launch sequence: flush/acknowledge browser edits → create handoff intent with file ID, base revision, expiry and nonce → request desktop launch → desktop confirms acceptance through an authenticated session → browser becomes read-only. A protocol URL alone cannot prove an application launched. If desktop is missing/offline, leave a recoverable browser draft and allow cancellation/resume after re-reading the server. If product policy makes the tab read-only immediately, label it pending and provide that recovery path. A handoff flag is not a lock; ETags still protect other tabs. Desktop completion must trigger a fresh browser read, not reuse cached bytes.

## Rollout, rollback and estimates

Pilot with an explicit Files action, then opt-in default for tested simple DOCX, then broader MIME registration after per-format gates. Keep richdocuments and its container available throughout. A week of real use is necessary but not sufficient to remove Collabora: complex-file fallback must also work on every device, backup restore must be demonstrated, and no unresolved P1 or data-loss incident may remain. Disable NeoCraft handlers to roll back; original files and supported app versions must remain usable.

Planning estimate for one experienced developer, excluding review/owner testing and upstream churn: integration spike 2–4 days; isolation/safety/CI 1–2 weeks; document core plus txt/md 3–5 weeks; DOCX subset/scanner 3–6 weeks; browser productization 2–3 weeks; RTF 2–4 weeks; desktop handoff 3–5 weeks. These are rough scope estimates, not commitments; real document corpus results may change them. The first usable opt-in text prototype should arrive much earlier than complete four-format cutover.

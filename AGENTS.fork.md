# Rules for agents in this repo (our pipeline)

Upstream's `AGENTS.md` and `CONTRIBUTING.md` are upstream's: read them and follow them for code. These are our pipeline rules on top. Full pipeline: the owner's private pipeline repo (`PIPELINE.md`, `RULES.md`, `RUBRIC.md`); this is the short copy.

1. **Find the stage** in `PIPELINE.md`. Plan: `ROADMAP.md` (decisions D1-D16). Code map: `docs/review-2026-10-24/CODE-MAP.md`.
2. **Work from an issue.** Take one that is not `in-progress` and not blocked; add `in-progress` before you start. Its body is your brief; an Easy issue has a "Qwen brief" section.
3. **Your own platform's issues first.** Mac, Windows and Linux all matter: say which you built on.
4. **Check that it builds**, then open the PR against `main`. CI and a review by another satellite with another model do the rest.
5. **Label the PR** `by:<machine>` and `model:<model>`, and write `Closes #N`.
6. **A failed job** gets a comment on the issue saying what happened, and the issue moves up one size.
7. **No private details** in code, commits, issues or PR text: no names, e-mail addresses, home paths, machine names, or private hostnames. Issues and reports carry counts only. Commit as the no-reply identity; never add the owner to contributors, AUTHORS or a changelog credit.

## This project

- **Track upstream (hughhowey/neo):** our code lives in new files; hooks into `app.js` and `main.js` are small and marked `// NEOCRAFT:`. Upstream's `main` is merged in monthly.
- **Never silently overwrite a file NeoCraft cannot fully hold:** the fidelity scanner offers a fallback or a save-as-copy.
- **Markdown saves byte-faithful:** open, then save with no edits, gives identical bytes.
- **Every save is guarded** (If-Match or mtime); a conflict saves a copy.
- **Secure server links only:** never write a LAN name or a plain `http://` URL into a link.
- **Golden task:** open a real .docx from Nextcloud Files in the browser, fix a paragraph, Launch external, keep editing on the desktop, save, reopen it in the browser and see the edit; then open a real .md with frontmatter, save it unchanged and confirm the bytes did not change.

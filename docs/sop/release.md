# SOP · Releasing project-atlas

**Owner:** Rajneesh Maurya
**Review every:** 90 days
**Last verified:** 2026-08-11

This is the procedure a release follows. It is an SOP rather than a guide because following it wrongly
ships a broken plugin to everyone who has it installed.

## Steps

1. `atlas branch <type> <slug>` — the tool marks the plan item in progress.
2. Make the change. Tests first where the change is a fix.
3. `node tests/run.mjs` — all green, no exceptions.
4. `./bin/atlas all` then `./bin/atlas build --verify` — the generated site audits itself.
5. Bump the version in `.claude-plugin/plugin.json` and `plugins/atlas/.codex-plugin/plugin.json`.
6. Write the CHANGELOG entry: what broke, why it broke, what now stops it recurring.
7. Commit with the plan item named in the subject. The gate refuses a shipped change that names none.
8. Merge to `main` and push **only after explicit confirmation**, every time.

## Why step 8 is not automated

Publishing is outward-facing and effectively irreversible. Everything before it is derived and safe to
delete; that is exactly what makes the rest safe to automate and this step not.

# Handoff — Rajneesh Maurya

**Identity:** `hi@rajneeshmaurya.com` — the key `atlas contrib` already groups commits by
(`scripts/lib/contrib.mjs:159`). The directory is the slugified name because a directory called
`hi-at-rajneeshmaurya-com` helps nobody; the email above is what makes it unambiguous, and the tool reports a
collision rather than silently merging two people who share a display name.

My working state only. Anything that constrains other people belongs in [`../SHARED.md`](../SHARED.md), and
anything readable from the repository belongs in neither.

**Last updated:** 2026-08-10, at `b36e260`

## Mid-flight

- **Track 6 (Autonomy) is designed and entirely unbuilt** — eleven items, A-1 to A-11, plus A-12 for this
  contributor-scoped layout. Nothing in it has code. `A-1` is the foundation everything hangs off; `A-10` is
  P0 and the one that changes how sessions end.
- **The wiki carries pre-0.1.35 CSS.** The responsive fix shipped to `main` and the Pages site but the wiki
  was published before it. One `atlas publish --target wiki` away, and it will need `--force` only if
  something there was hand-edited.
- **`docs/HANDOFF.md` moved here**, so the wiki has an orphaned `HANDOFF` page from the previous publish.
  Publish never deletes pages it no longer recognises, deliberately — remove it by hand if it bothers you.

## Where I'd pick up

`A-10`, and treat the hook question as the real decision rather than the implementation. Three hooks is the
third time this project has been asked to add hooks, and it has twice concluded that extra hooks are how a
tool gets switched off. If a `SubagentStop` flush cannot be made invisible, the honest outcome is that the
journal stays a manual `atlas note` and the design says so.

## Personal notes

- I keep reaching for `atlas` when I mean `./bin/atlas`. Everything under `scripts/` that looks like it did
  not take effect is this, every time.
- Reading the CI log directly beat guessing twice, expensively. `gh` is still not installed here; the REST
  API with the keychain credential works.

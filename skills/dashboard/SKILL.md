---
description: Build the site, start the live dashboard server, open it in the browser and print the URL. Use when the user asks for the dashboard, the wiki, the site or a link to it, when they ask where the dashboard is or whether it is running, or when they type /atlas:dashboard.
disable-model-invocation: true
---

# Dashboard

!`atlas serve`

# Every dashboard on this machine

!`atlas serve --list`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "no dashboard is running".

---

`atlas serve` has already run above. It builds first, starts the server if it is not up, opens the browser,
and is idempotent — running it when a server is already up opens the page rather than fighting for the port.

**Your entire job is to report the URL as a link, on its own line, as the first thing you say.** Not a file
path. Not "the site is built". A `http://127.0.0.1:<port>/` URL the user can click.

This command exists because the automatic path failed once in a way worth not repeating: three repositories
were adopted in one afternoon, all three servers started themselves and answered, and no session ever
printed a port. The dashboard being up is not the deliverable — **the user knowing where it is** is the
deliverable.

## Reading the block above

- **A URL was printed** — say it, say whether it was already running or just started, and stop. One screen.
- **"Port … is already in use"** — something else holds the derived port. Say what
  `lsof -nP -iTCP:<port> -sTCP:LISTEN` would name, and offer `atlas serve --port <other>`.
- **"Started pid …, but it is still not listening … after 20 seconds"** — the child did not bind. Run
  `atlas serve --status`, which says whether something else holds the port; `atlas watch --serve` surfaces
  the error itself. This used to be printed after *two* seconds, while the child was still running the build
  it does before binding, so it was usually a false alarm about a server that came up fine (A-49).
- **"Stopped N orphaned dashboard server(s)"** — servers that were still serving directories which have
  since been deleted. **Report this; do not skip it as housekeeping.** It is how the reader learns the tool
  had been leaking processes, and it is stated because two such leaks went unnoticed for a whole session
  each. Each line names the pid, the port and the directory that is gone.
- **A line saying a server was `left`** — a candidate the reaper refused to signal, with the reason. It is
  still running. Pass the reason on rather than summarising it away; the operator is the only one who can
  decide what that process is.
- **The block is empty or says the config is missing** — this repository has not adopted the tool. There is
  nothing to serve yet, and serving an empty output directory would produce a page that looks broken. Say
  so and run `atlas:build`, which does the adoption and ends here anyway.
- **`atlas` not on PATH** (both blocks empty) — the plugin is not installed where this is running. Say that
  plainly; do not read an empty section as "nothing is running".

## The list

The second block names every atlas dashboard running on this machine, one port per project, derived from the
repository path so they never contend. Show it **only when it has more than this repository in it** — with
several projects open the useful question stops being "is it up" and becomes "which one am I looking at".

It is read from the machine's **process table**, not from the registry file, because the registry was once
empty while two dashboards were answering and this skill printed "No atlas dashboards are running on this
machine." directly beneath a correct URL it had just reported (A-49). Two rows need saying out loud when
they appear:

- **`root deleted; orphan`** — that server is serving a directory that no longer exists. Anyone who opens it
  reads another repository's branch and file counts believing they are their own. Say so, and say that
  `atlas serve` or `atlas stop` ends it. A listing never signals anything itself.
- **`running, but what it serves could not be established`** — a real server this could not place. It is
  never reaped, for exactly that reason. Report it as unknown rather than as fine.

If the block says the process table **could not be read**, that is not "nothing is running". Say the
difference; the sentence in the output already draws it, so do not flatten it back down.

`atlas serve --launcher` writes a single page linking all of them, if the user wants one bookmark instead of
several.

## When they ask for it a second time

A user who asks where the dashboard is more than once is telling you the line scrolled away. Offer the
statusline, which puts the URL in the bar at the bottom of the terminal where it cannot:

```bash
atlas-statusline --install     # undo with --uninstall; --project scopes it to this repository
```

**Offer it, do not run it.** It writes `~/.claude/settings.json`, which is the user's environment across every
repository they open and not this tool's to change — the boundary in `docs/references/autonomy.md`. Say what
the command does and let them type it. It prints nothing in repositories that have not adopted the tool, and
it refuses to overwrite a statusline they already have.

## What not to do

- **Do not report a filesystem path instead of a URL.** `docs/_wiki/index.html` is not a dashboard; it is a
  file. Opening it directly gets a page whose live-reload polling cannot reach anything.
- **Do not stop the server to "clean up".** It exits on its own once nothing has read it for four hours, and
  `atlas serve` already stops the ones whose repository is gone. `atlas serve --stop` is for when the user
  asks.
- **Do not kill a process by hand.** If a port looks wrong, `atlas serve --list` names what is there and
  `atlas serve` reaps what is safe to reap. Reaching for `kill` on a pid found by `lsof` is how the wrong
  process gets ended, which is worse than the leak.
- **Do not publish anything.** This is loopback-only, on this machine. Publishing is `atlas:publish`, it is
  outward-facing, and it is confirmed every time.

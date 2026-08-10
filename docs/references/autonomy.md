# Autonomy

Everything project-atlas can do without being asked, what it will never do without being asked, and the one
line that separates them.

This is a design document for a capability that is **not yet built**. It exists first because the feature's
whole risk is in its defaults, and defaults are cheaper to argue about than to retract.

## The line

**Autonomy is granted over derived state. It is never granted over outward-facing actions.**

Everything this tool produces is derived and safe to delete — that is the project's founding rule, and it is
also the exact test for what may run unattended. A build can be re-run. A push cannot be un-pushed.

| | Reversible by | Autonomy |
|---|---|---|
| Index, health report, dashboard, deck, role views | deleting a directory | **yes, default on** |
| Stats, analysis, worklog, token and session accounting | deleting a file | **yes, default on** |
| Task list reconciliation against the plan | `git checkout` | **yes, default on** |
| Branch creation, staging a publish, a local artifact | `git branch -d`, `rm` | **yes, default on** |
| Commit | `git reset` | **opt-in, default off** |
| `git push`, wiki publish, Pages publish, a shared artifact | nothing | **never** |

The last row is not a configuration option. A tool that publishes on your behalf publishes your mistakes on
your behalf, and the drift guard, the health gate and the branch guard all exist because this project has
already been bitten by the class of thing that happens when a step nobody watched went one step further than
expected.

## Why "fully autonomous" stops short of publishing

Asked for directly, the honest answer is that the request conflicts with three rules already shipped:

- `atlas plan` proposes a route and **executes nothing without approval**.
- `publish` stages by default and pushes **only** with `--push`, confirmed each time — not once per session.
- The commit hook **refuses** rather than asking, because a prompt is a thing people learn to dismiss.

Those rules are the product. Making them configurable would not add a feature; it would remove the one this
tool is for. So autonomy is defined as *everything up to the edge of the repository*, and the edge stays
manual. In practice this costs one command — the work is already staged, reviewed and described by the time
a human types it.

If that boundary is wrong for a given repository, the honest version is not a flag that publishes silently.
It is CI: a workflow that runs on a branch you already trust, where the audit trail is the run log. That is a
different mechanism with a different accountability story, and it should be configured as one.

## Configuration

```jsonc
{
  "autonomy": {
    "enabled": true,              // the master switch; false disables every automatic action below
    "build": true,                // regenerate the site when markdown or the generator changes
    "stats": true,                // refresh contribution, token and session figures
    "worklog": true,              // write the day's log
    "tasks": true,                // reconcile the task list against the plan and report drift
    "sop": true,                  // maintain SOP documents: owner, review date, last verified
    "branch": "warn",             // "enforce" | "warn" | "off" — see below
    "artifact": "local",          // "local" (self-contained file) | "off"
    "commit": false,              // opt-in: commit derived output with a stated message
    "publish": false              // not configurable to true; present so its absence is explicit
  }
}
```

Every key defaults to the value shown. `enabled: false` turns the whole subsystem off in one line, because a
feature that can only be disabled key by key is a feature nobody disables.

### `branch` — follow, warn, or unfollow

The branching strategy is a convention this repository already documents in
[`branching.md`](branching.md). Autonomy adds three postures over it, and *warn* is the default because
silently enforcing someone's git workflow is the fastest way to have the whole tool switched off:

- **`enforce`** — creating work on a protected branch is refused, and the fix is offered. Today's behaviour.
- **`warn`** — the convention is stated, the divergence is named, and the work proceeds. You have
  unfollowed the strategy deliberately, and the tool says so once rather than arguing.
- **`off`** — no branch opinion at all. The guard still refuses a commit to a protected branch, because that
  is a repository rule, not a strategy preference.

The distinction that matters: **unfollowing is allowed, unfollowing silently is not.** A warning that names
what was skipped leaves a record; a tool that says nothing leaves the next person to discover it.

## Keeping the dashboard current as work happens

The requirement is that marking a task complete or adding a new one updates the dashboard immediately, not at
the next time someone remembers to build.

**Half of this already works.** Every generated page polls `build-stamp.txt` and reloads itself when the
stamp moves, and `atlas watch` rewrites that stamp on every change. An open dashboard under `atlas watch` is
already live. What is missing is the trigger for the case where `watch` is not running — which is most of the
time, because starting a watcher is another step someone has to remember.

So the trigger becomes a hook on the one file that matters:

```
PostToolUse · Edit|Write · matching planning.source  →  atlas build --dashboard-only
```

**This reopens a decision the project already made once, and the objection was correct.** A `PostToolUse`
hook running health after *every* markdown edit was written and removed, because a check that makes every
edit slower is a check people disable. Three things make this version different, and if they do not hold the
feature should not ship:

- It fires on **one file** — whatever `planning.source` points at — not on every markdown file.
- It regenerates **the dashboard only**, not the index, the document pages or the deck.
- It runs **detached**, so the edit that triggered it never waits on it.

If a dashboard-only rebuild cannot be made fast enough to be invisible, the honest answer is to leave this to
`atlas watch` and say so, rather than shipping a hook people will disable.

## SOPs

An SOP is a document that is *wrong* rather than merely stale when it drifts, so it carries obligations an
ordinary document does not: an owner, a review interval, and a date it was last verified against reality.

Autonomy over SOPs means the tool maintains those obligations, not the prose. It never rewrites a procedure —
it reports which ones have passed their review date, which name an owner who no longer appears in the git
history, and which cite code that has moved. Three new signals, in the existing vocabulary:

| Signal | Fires when | Class |
|---|---|---|
| **H10** | an SOP is past its `review-by` date | blocking |
| **H11** | an SOP names no owner, or an owner absent from the last 12 months of history | advisory |
| **H12** | an SOP cites a file that no longer exists | blocking |

H10 and H12 are blocking on purpose. An expired procedure is not documentation debt; it is an instruction
someone may follow today.

## What autonomy will never do

Stated explicitly, in the same spirit as the dashboard's own "what this does not show":

- Push anything, anywhere, for any reason.
- Publish to a wiki, a Pages branch, or a shared artifact.
- Rewrite prose. It maintains metadata, indexes and derived pages; the words stay yours.
- Force past a guard. Every refusal that exists today still refuses.
- Act on a repository that has no `project-atlas.config.json`. Adoption is a decision, not a default.

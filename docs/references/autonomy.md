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

## Memory and handoff

A session ends and everything it learned that was not written down is gone. The next one re-derives what it
can and rediscovers the rest by hitting it again — which is how the same trap costs time twice.

Two artefacts, and the split between them is the whole design:

**`HANDOFF.md` — what cannot be derived.** Decisions already taken, traps already paid for, work in flight,
and the reasoning behind a boundary so it is not re-litigated. The tool must never generate this: a machine
can see that a commit happened, not that a decision was argued and settled. What the tool *can* do is keep
its header honest — the commit and version it was last written against — and raise a signal when the corpus
has moved a long way past it.

**Everything else — derived, and therefore not in the handoff.** The plan, the history, the health report,
the statistics. `HANDOFF.md` carries a standing instruction to delete any fact that can be read from the
repository, because a handoff that duplicates derived state goes stale exactly the way this project exists to
detect. `ROADMAP.md` already carries a warning about that failure happening to itself, twice.

### Continuity — surviving a termination

A handoff written at the end of a session is written exactly when it cannot be: the session that gets killed,
compacted, or interrupted never reaches its own last step. So state has to accumulate *as work happens*, not
be summarised afterwards.

That means two files, not one, and conflating them is the mistake to avoid:

| | `docs/HANDOFF.md` | `.atlas/journal.jsonl` |
|---|---|---|
| Written by | a human, or an agent proposing a draft | every agent, continuously |
| Contains | decisions, traps, reasoning | what was touched, what was decided, where it got to |
| Shape | prose | append-only records, one JSON object per line |
| Survives a kill | only if it was written | yes — each line is flushed as it happens |
| Published | yes, it is part of the corpus | **no** |

The journal is append-only and each record is a single `write()` of one line, so a process killed mid-run
loses at most the record it was writing and never corrupts what came before. A summary held in memory and
flushed at exit is the design that fails precisely when it is needed.

**Subagents write to the same journal, tagged.** Each record carries the agent that wrote it, so a main
session can read back what a subagent established before it ended — the case where context is most often
lost, because a subagent's reasoning is discarded by design and only its final message survives.

```jsonc
{"at":"2026-08-10T14:22:31Z","agent":"main","kind":"decision",
 "text":"autonomy stops at the repository edge","refs":["docs/references/autonomy.md"]}
{"at":"2026-08-10T14:31:04Z","agent":"explore-1","kind":"finding",
 "text":"wikiPageName emits a leading dot that isSafePageName rejects","refs":["scripts/lib/publish.mjs:61"]}
```

`atlas note <kind> <text>` appends one record. `atlas state` prints the current reconstruction — branch,
version, what is uncommitted, what the journal has recorded since the last handoff — which is what a resuming
session reads first.

**Enforcement is a hook, because prose does not survive a crash either.** An instruction telling agents to
journal is advisory, and an agent that is terminated does not read instructions. The harness fires
`SubagentStop` and `Stop` whether or not the agent cooperated, and `PreCompact` before context is discarded —
those are the moments state must be flushed, and they are the tool's to claim.

This is the third time this project has weighed adding a hook, and the earlier objection still applies: a
check that makes every action slower is a check people disable. The test is the same — one file, appended,
detached — and if it cannot be made invisible it does not ship.

**The journal never carries prompt text.** Same rule as `atlas tokens` and `atlas sessions`, and for the same
reason: it records what was decided and touched, never what was said. It is also excluded from publishing by
construction, in the same way a token report is refused a path inside the output directory.

One signal:

| Signal | Fires when | Class |
|---|---|---|
| **H13** | `HANDOFF.md` names a commit more than N commits behind `HEAD` (default 50) | advisory |

Advisory, not blocking. A stale handoff is a cost, not a hazard, and a blocking signal on a file this
subjective would train people to suppress it.

`atlas handoff` prints the derived half — what changed since the recorded commit, which items moved, what
health says now — as a **prompt for a human to write the rest**, never as the file itself. The distinction is
the same one the tool makes everywhere: it reports, and the words stay yours.

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

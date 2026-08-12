# Token economics — the data contract

Status: specification for C-10, C-11 and Q-4. Written before the code so three workstreams can build
against one shape. If the code and this document disagree, the code is wrong until this is amended.

## Why this exists separately from `atlas tokens`

`atlas tokens` already answers *how much*. Every question left is a **join**, and a join needs an agreed
shape or three modules invent three of them. That is the fork this tool exists to detect, so the shape is
written down first.

## Source, and what may never leave it

Local Claude Code transcripts under `~/.claude/projects/<slug>/*.jsonl`. These are **not part of the
repository**: machine-local, unversioned, and gone if cleared. They contain every prompt and every file read
of every session.

Three rules, and no reading of this data may break them.

1. **Counts only.** No prompt text, no message content, no file paths from the transcript body. A path may be
   used *transiently* to classify a write into a kind of work, and must not be retained in any output.
2. **Local by default.** Every panel built on this carries `data-local-only`, the marker `stripLocalOnly`
   already enforces on both exit doors — `exportSingleFile` and `exportBundle`.
3. **The snapshot is opt-in and counts-only.** `atlas tokens --snapshot`, gated on `tokens.snapshot` in
   config, writes `.atlas/tokens.jsonl`. Nothing writes it implicitly, and no build writes it.

## What the transcript gives us

Verified present on records in this repository's own transcripts:

| Field | Use |
|---|---|
| `timestamp` | the join key for every window |
| `usage.input_tokens` | fresh input |
| `usage.cache_creation_input_tokens` | the expensive rung |
| `usage.cache_read_input_tokens` | the cheap rung — 99.2% of all tokens here |
| `usage.output_tokens` | what was generated |
| `isSidechain` | **true on subagent turns** — the whole of C-11's measurement |
| `gitBranch` | which line of work |
| `sessionId` | session boundaries |
| `message.model` | model mix |

`toolUseResult` and `trackingPath` carry written paths; they are read to classify and never retained.

## The shape

`readTokenEconomics(root, cfg)` returns:

```
{
  available: boolean,
  reason: string|null,              // why not, when unavailable — never silence
  totals:   { input, cacheWrite, cacheRead, output, messages },
  days:     [ { day: 'YYYY-MM-DD', input, cacheWrite, cacheRead, output, messages,
                agentOutput, mainOutput } ],
  tasks:    [ { id, subject, status, opened, closed, output, cacheRead, messages,
                partial: boolean } ],
  kinds:    [ { kind, output, cacheRead, writes } ],   // planning|coding|testing|documentation|other
  agents:   { mainOutput, agentOutput, runs, peakConcurrent },
  branches: [ { branch, output, cacheRead, messages } ],
  rework:   [ { day, newWorkOutput, reworkOutput } ],
  caveats:  [ string ]              // rendered verbatim; never summarised away
}
```

### Attribution rules

**Per task.** A task is open from its `create` record to its first `update` with
`status: "completed"`. Assistant turns whose `timestamp` falls inside that window are attributed to it.
Windows **overlap** — several tasks are open at once — so a turn attributed to *n* open tasks contributes
`1/n` to each, and any task whose window overlapped another is marked `partial: true`. The view must show
that flag. A total that silently double-counts is the failure this rule exists to prevent.

**Per kind.** Classify by the paths written during the turn, through the taxonomy already in
`project-atlas.config.json`:

- `testing` — matches the test globs
- `documentation` — resolves to a document cluster
- `planning` — the plan file, or a journal/task write
- `coding` — anything else under source
- `other` — no write happened in that turn

A turn that writes to two kinds splits evenly, by the same rule as tasks.

**New work vs rework.** Do not invent a second definition. `contrib.mjs` already computes rework as *a file
re-touched within 3 days*; join its per-day verdict to the per-day token series. Two answers to one question
is the fork this tool exists to detect.

**Per agent.** `isSidechain === true` is a subagent turn. `peakConcurrent` is the maximum number of distinct
`sessionId`s with sidechain turns inside any one minute.

### What it must refuse

- **No per-contributor axis.** There is no git author in a transcript. The view names agents and branches and
  says plainly why there is no person axis.
- **No cost in currency** unless `tokens.rates` is configured, and then only with the rates named on the page.
- **No blended "tokens used" headline.** Cache read is 99.2% of the total here; one number treats it as equal
  to fresh input, which is what makes a cheap session look expensive.
- **No estimate for a session with no transcript.** Unavailable is a state, not zero.

## Charts

Interactive, inline SVG with no external library — the CSP on published pages forbids one, and every other
chart here is already hand-rolled. Use the existing `weeklyAxis`/axis helpers rather than adding a third
implementation of a time axis.

1. **Tokens over time** — stacked by tier, the historical graph. Continuous axis, silent days drawn as zero
   and counted aloud, the defect C-8 fixed on `velocityChart`.
2. **Tokens vs tasks completed** — spend against tasks closed, same axis.
3. **New work vs rework**, by day.
4. **Kind of work** — planning / coding / testing / documentation.
5. **Main agent vs subagents**, with peak concurrency — the C-11 panel.

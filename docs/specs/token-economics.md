# Token economics — the data contract

Status: specification for C-10, C-11 and Q-4. Written before the code so three workstreams can build
against one shape. If the code and this document disagree, the code is wrong until this is amended.

**Amended while building the C-10 data layer.** Several things were wrong or under-specified and are
corrected in place below, each marked **Amended**: the signature is synchronous, the classification order had
to be reversed, "document cluster" meant the wrong test, the returned shape carries no cost field, `other`
turns out to be almost all of the output, and — the one that mattered most — **the source was being read from
the wrong place, so every subagent token in the store was invisible.** Nothing was changed silently; the whole
point of writing this first was that a divergence would be visible.

## Why this exists separately from `atlas tokens`

`atlas tokens` already answers *how much*. Every question left is a **join**, and a join needs an agreed
shape or three modules invent three of them. That is the fork this tool exists to detect, so the shape is
written down first.

## Source, and what may never leave it

Local Claude Code transcripts under `~/.claude/projects/<slug>/*.jsonl`. These are **not part of the
repository**: machine-local, unversioned, and gone if cleared. They contain every prompt and every file read
of every session.

**Amended — that glob is the whole store only for the main session.** A subagent writes to
`~/.claude/projects/<slug>/<session-id>/subagents/agent-<id>.jsonl`, one directory down, and a flat
`readdirSync(dir).filter(f => f.endsWith('.jsonl'))` never descends into it. `readTokens` had been reading the
store that way since it was written. Measured on this repository's own store: **20 files, 4,569 records and
1,085,725 output tokens — 30% of all output — invisible to every figure the module produced.** It was worse
than a shortfall, because it was a shortfall in exactly one direction: every token a subagent spent. The
main-versus-subagent axis that C-10 and C-11 are built on read a flat zero and presented it as a measurement.

Beside each subagent transcript sits `agent-<id>.meta.json`, carrying `agentType`, `spawnDepth` and a
`description` — the agent's brief, which is the prompt in miniature. **It is never opened.** Nothing needs it:
`agentId` is on every record of the transcript itself.

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
| `isSidechain` | true on subagent turns — but it is not where they live; see below |
| `agentId` | **which** subagent — the key concurrency has to be counted on |
| `gitBranch` | which line of work |
| `sessionId` | session boundaries, and *not* a subagent boundary |
| `message.model` | model mix |

`toolUseResult` and `trackingPath` carry written paths; they are read to classify and never retained.

**Amended — `isSidechain` is true on 0 of the 4,392 records in the main session files here.** The field was
verified present; its value was not. Every one of this repository's sidechain turns is in a subagent
transcript, where it is `true` on all 4,569 records. A reader that looks only at the session files therefore
sees the field, finds it never set, and concludes nothing was ever fanned out. **Living in the subagents
directory is itself sufficient evidence** and the implementation treats either witness as enough, because one
of the transcripts here does not set the flag at all.

**Amended — concurrency must be counted on `agentId`, not `sessionId`.** Every record in a subagent
transcript carries the **parent's** `sessionId` — verified on all twenty. Counting distinct sessions would
report a peak of one for a session that fanned six agents out at once, which is the exact claim C-11 exists
to test, answered with the wrong key. `runs` is the count of distinct `agentId`s that left a transcript.
`sessionId` remains the fallback for a sidechain turn written inline in a session file, the older shape,
where there is no agent id and the session is the only discriminator available.

**Added — `agents` also reports `spawns` and `spawnsWithoutTranscript`, and they are never spend.** A spawn
tool call says fan-out was *requested*; a transcript says it *ran and cost something*. One session on this
machine has four spawn calls and no subagent transcripts at all — its agents ran in worktrees of their own, or
their transcripts were cleared. Folding spawns into the token axis would let an agent with no observed spend
raise peak concurrency with nothing behind it; reporting a bare zero after four spawns is the silence this
tool forbids. So both are reported, separately, and the gap between them is named in the caveats. A spawn
contributes no tokens and no concurrency, because none was observed.

**Amended — a written path arrives at `toolUseResult.filePath`, and only from `Edit` and `Write`.** A `Read`
puts its path one level down at `toolUseResult.file.filePath`; matching that too would classify a turn that
read a test and changed a source file as testing. `trackingPath` is a relative path and appears alongside,
never instead.

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
  agents:   { mainOutput, agentOutput, runs, peakConcurrent,
              spawns, spawnsWithoutTranscript },   // added — see the amendment above
  branches: [ { branch, output, cacheRead, messages } ],
  rework:   [ { day, newWorkOutput, reworkOutput } ],
  caveats:  [ string ]              // rendered verbatim; never summarised away
}
```

**Amended — the signature is synchronous.** `readTokens` is `async` because it streams, and it has exactly
one caller: a command. This has three — a command, a dashboard panel and a health signal — and `buildIndex`,
`runHealth` and `renderSite` are all synchronous. An `async` reader would have forced an `await` through the
whole render path, or forced the panel to be fed from outside it, which is how a view ends up with a data
source nothing else can check. It reads in 1 MB chunks rather than slurping the file; the transcripts here run
to 24 MB each and the full pass over 78 MB takes under a second.

**Amended — there is no `cost` field, and that is deliberate.** The shape above has none, so this module
never returns currency at all. `atlas tokens` continues to print cost from `readTokens`, gated on
`tokens.rates` and printed with the rates named, exactly as before. Anything built on `readTokenEconomics`
therefore cannot show a price by accident.

**Amended — when `available` is false, `totals` and `agents` are `null` and the arrays are empty.** Not
zeroes. A zero is a claim that nothing was spent; the claim being made is that nothing is known. The `reason`
is also pushed into `caveats`, because a view renders the caveats and would otherwise have to know to look in
two places.

**Amended — a `rework` row may carry `null` for both figures.** A day with token spend and no commit has no
rework verdict, and reporting it as a day of pure new work would be a claim from silence. The row is present
so the axis stays continuous — the C-8 defect — and the figures are `null` so the day reads as unknown.

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

**Amended — the order above is not the precedence, and cannot be.** Taken literally, `documentation` is
tested before `planning`, and the plan file is markdown inside a cluster — so it resolves as documentation and
the "planning is the plan file" clause never fires for any repository that keeps its plan in markdown, which
is all of them. Naming a specific file and then letting a general rule swallow it is the same defect the
cluster taxonomy already fixed by putting filename rules ahead of directory rules. **The implemented
precedence is testing → planning → documentation → coding**, and it is asserted by a test.

**Amended — "resolves to a document cluster" is the wrong test.** A cluster answers *which* document this is;
the question here is *whether* it is one. This repository's own clusters match `hooks/**`, so a shell script
would have classified as documentation. The implemented test is the corpus test the rest of the tool uses —
matches `include`, not matched by `exclude` — which is what decides whether a cluster is ever consulted.

**Amended — there is no `testGlobs` in `project-atlas.config.json`.** The contract says "matches the test
globs" and the taxonomy it points at has no such concept. `tokens.testGlobs` was added with a default
covering the conventional layouts (`tests/**`, `**/*.test.*`, `**/__tests__/**` and so on).

**Amended — a write outside the repository is `other`, not `coding`.** A scratch file in a temp directory is
a real write and is not this repository's source. `other` therefore reads as *no write inside this repository
in that turn*, which covers both cases honestly, and the count of out-of-repository writes is stated in the
caveats.

**Amended, and unresolved — `other` is almost all of the output.** Measured over this repository's own
transcripts: 4,809 assistant turns produced 3.66M output tokens, of which **3.59M (98%) fall in `other`**,
because the overwhelming majority of turns read, search, reason or run a command and write no file at all.
The rule as specified is implemented and honest, but the panel it feeds will be one enormous bar and four
slivers, and "kind of work" will not be measuring what the item wanted it to measure. The fix is a change to
the rule, not to the code — attributing a turn to the kinds written by the *contiguous run* or *task window*
it belongs to, rather than by that single turn — and it needs a decision before the chart is drawn.

**New work vs rework.** Do not invent a second definition. `contrib.mjs` already computes rework as *a file
re-touched within 3 days*; join its per-day verdict to the per-day token series. Two answers to one question
is the fork this tool exists to detect.

*Amended — `contrib.mjs` did not publish a per-day verdict; it published a single rate.* Rather than
recompute the window here, `aggregateQuality` now emits `quality.reworkByDay` as `[{ day, touches, rework }]`
**out of the loop that already computes the rate**, so there is still exactly one definition of the word in
the repository and the two surfaces cannot drift apart.

**Per agent.** `isSidechain === true` is a subagent turn. `peakConcurrent` is the maximum number of distinct
`sessionId`s with sidechain turns inside any one minute.

*Superseded by the two amendments above*: a turn is a subagent turn if `isSidechain` is true **or** it came
out of a subagent transcript, and `peakConcurrent` is counted on `agentId`.

### What it must refuse

- **No per-contributor axis.** There is no git author in a transcript. The view names agents and branches and
  says plainly why there is no person axis.
- **No cost in currency** unless `tokens.rates` is configured, and then only with the rates named on the page.
- **No blended "tokens used" headline.** Cache read is 99.2% of the total here; one number treats it as equal
  to fresh input, which is what makes a cheap session look expensive.
- **No estimate for a session with no transcript.** Unavailable is a state, not zero.

## The snapshot on disk

*Added — the contract named the file and its gate but not its contents, and a file three workstreams may read
needs a shape as much as the function does.*

`.atlas/tokens.jsonl` is one JSON object per line, one line per day, append-only. Fixed key order and
integers only, so a given input produces a given byte sequence on any machine — which is what makes the file
diffable and lets a re-run tell "this day changed" from "this day was written again".

```
{"v":1,"day":"2026-01-01","input":1,"cacheWrite":2,"cacheRead":3,"output":4,"messages":5,"mainOutput":6,"agentOutput":7}
```

Read it the way the journal and the task log are read: replay the file and let the last line for a day win. A
day already recorded with identical counts is not appended again, so running `--snapshot` twice over an
unchanged store writes nothing. It is **not** gitignored — the point is that it reaches a clone — and it
carries no task subject, no kind, no branch and no path, because those are the fields through which text
would escape.

## Configuration

| Key | Default | What it does |
|---|---|---|
| `tokens.snapshot` | `false` | The gate. Without it `--snapshot` refuses and says which setting would allow it. |
| `tokens.snapshotFile` | `.atlas/tokens.jsonl` | Refused if it resolves inside the published output directory. |
| `tokens.testGlobs` | conventional test layouts | What counts as `testing` for the per-kind split. |

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

---
description: "The shape of this repository's branches — what was cut from what, where each split off, and what has already gone back into the trunk. Use when the user asks how branches relate, which branch another was cut from, what descends from a branch, or types /atlas:git-tree."
disable-model-invocation: true
---

# The topology

!`atlas git-tree --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "this repository has one branch".

---

Lead with **the shape**: how many branches hang directly off the trunk, which ones have branches of their own,
and which could not be placed. Then answer the question that was actually asked.

## Git does not record a parent, and every edge above is an inference

This is the one thing to get right when reporting this command. A branch is a moving pointer at a commit.
Nothing in a repository stores where that pointer started, so **there is no fact of the matter to look up** —
the tree is read out of the commit graph and, where the reflog still has it, out of a local record that
expires.

So: **never restate an edge as though git recorded it.** "`feat/x` was cut from `development`" is the tool's
inference; "the graph puts `feat/x` under `development`" is what happened. When the user is about to rebase
or delete something on the strength of it, say which.

The five things a row can say about its origin, and what each is worth:

- **`forked at <sha>`** — the merge base. That commit is a **fact**; which side of it is the parent is not.
- **`probably cut from <trunk>, same point as <others>`** — the branch and those others left the trunk at one
  commit. They are siblings. **Do not pick one of them as the parent of another** — that is a coin toss with
  a report's authority behind it, and it is the specific error this command was built to avoid.
- **`split from <other>; nothing in the commit graph orders them`** — the two share history past the trunk and
  the graph is genuinely symmetric: this is what "cut a branch, then keep committing on the one you cut it
  from" looks like afterwards. **Neither is named the parent.** Both are drawn under the trunk.
- **`ordered from this clone's reflog`** — the graph could not tell, and the reflog could. Treat it as true
  *here*: a reflog is per-clone, expires (90 days by default), and is empty in a fresh clone. On someone
  else's machine this edge would not exist.
- **`origin unknown — …`** with the branch under *topology could not be established* — the question could not
  be asked at all, usually unrelated histories. **This is a result, not a gap in the output.** Report it as
  the answer, with its reason.

## Rules

- **This command deletes nothing, rebases nothing, and does not print a command that would.** Like every
  other `/atlas:git-*` surface, it is built to be safe to run blind — including by something that acts on
  what it reads. If the user wants to clean up or restructure, name the branches and let them type it.
- **Do not fetch.** Remote-tracking refs are as fresh as somebody else's last fetch and this runs none.
- **`spent` is not `at-main`.** A merged branch with work behind it is finished. A branch sitting on the
  trunk's own commit is *new* — a sibling session's working branch looks exactly like that, and calling it
  finished is how work gets deleted.
- **Age is days behind this repository's newest commit**, not days on a calendar. "79d" means the branch is
  79 days behind the last thing that happened here, which is a fact about the branch rather than about today.
- **A `?` in the ahead column was never measured.** It is not zero.

## How this differs from `/atlas:git-branch`

`/atlas:git-branch` answers *how far ahead* — one independent row per branch, plus whether it is safe to
commit where you are standing. This answers *how they relate*. Both read the same refs through the same code;
if they ever disagree about a number, that is a defect worth reporting rather than a difference of opinion.

Reach for this one when the question has the word "from", "under", "descends" or "based on" in it.

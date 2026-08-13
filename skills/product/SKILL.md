---
description: One page across every repository under a product directory — which have adopted atlas, which have not, what their plans say, what is in flight. Use when the user asks about several sibling repositories at once, about "the product" rather than "this repo", when the session is running from a directory that is not a git repository, or when they type /atlas:product.
disable-model-invocation: true
---

# The product view

!`atlas product`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "there is no product here".

---

`atlas product` has already run above. It writes one page and prints a summary of it. **Report the member
table and the page path.** The path is the deliverable people lose, exactly as the dashboard URL is.

## What it is for

A product is rarely one repository. The case this was built for is thirteen sibling checkouts under one
directory — an Angular client, three Cloudflare workers, a monitoring service, an edge rewrite — where the
directory holding them is **not a git repository** and is never going to be one.

That shape breaks the rest of this tool quietly. Every atlas hook opens with
`root=$(git rev-parse --show-toplevel) || exit 0`, so a session run from the product directory gets nothing:
no task recording, no rebuild on write, no dashboard. The product view is the one surface designed to be run
from a directory that is not a checkout, and from there it is the only thing the user can see at all.

## Reading the block above

- **`Not a product root: … is itself a git repository`** — the command was run inside a member. It does
  **not** go looking upward on its own: guessing at somebody's directory layout renders a page about
  repositories they never asked about. The output names the parent and the exact flag. Offer that command;
  do not invent a different one.
- **`Not a product root: … holds no git checkouts`** — this is an ordinary directory. Nothing to show, and
  that is a correct answer rather than a failure.
- **Rows marked `not adopted`** — these are the point of the page, not noise. Twelve of thirteen repositories
  in the case this was built for have never run `atlas init`, and a view that showed only the adopted one
  would report a one-repository product. Each row carries the markdown count that adoption would index and
  the single command that does it. **Say how many there are.** Do not summarise them away as "the rest".
- **A row marked `unreadable`** — a member that could not be read, with the reason. It is stated, never
  dropped, because a dropped row is indistinguishable from a repository that is not there. Pass the reason on.
- **`N product-level document(s) are committed to no repository`** — markdown at the product level, in no
  checkout and therefore in no history. Nothing has ever reviewed a diff of them and nothing can restore a
  previous version. Report it; it is usually news to the person reading.
- **`Health was not measured`** — true, and deliberate. Measuring it indexes every member's whole corpus,
  which is the thirteen-full-builds cost the page exists to avoid. `atlas product --deep` buys the numbers
  with real time. **A blank is not a clean bill of health**, and must never be reported as one.

## The page

It is written to `~/.claude/atlas/products/<name>-<hash>/product.html`, outside every repository.

That location is the feature. The owner's requirement was that the connecting layer *never commits*, and the
product directory — the obvious place to put it — is outside every repository only by the accident that
nobody has run `git init` there yet. `~/.claude/` is outside it structurally, which is a guarantee rather
than a hope. The command refuses `--out` anywhere inside a member or inside the product root, and the refusal
is an error, not a warning.

## What it does not do

- **It does not write, build or fetch in any member.** Reads only: one config file, one plan file, and three
  read-only git commands per member, each passed `--no-optional-locks` so not even git's stat cache is
  rewritten. If a user asks for a member to be rebuilt, that is `atlas build` **in that member**, run
  deliberately, not something this page does on their behalf.
- **It does not maintain a member list.** Members are discovered — every immediate child holding a git
  checkout — so a repository cloned tomorrow appears without anyone editing anything. Do not offer to write
  a members file; a list is a document that goes stale, which is the failure this whole tool detects.
- **It does not index the product-level documents.** It names them and counts their lines. Everything this
  tool renders is derived from a source under version control and re-derivable from it; that corpus has no
  repository to be derived from, so an indexed copy in a never-committed page would become the most durable
  copy of a document with no history. The remedy to offer is a home for them — a repository at the product
  level, or the member each one actually describes.
- **It carries no timestamp.** The output is byte-identical for an unchanged product, so a diff of the page
  means the product changed rather than that somebody re-ran the command.

## Useful follow-ups

```bash
atlas product --product <dir>   # name the product root explicitly (from inside a member, or anywhere else)
atlas product --deep            # index every adopted member and measure health — costs real time
atlas product --json            # the model, for a program
atlas serve --launcher          # the ports-only doorway: every running dashboard on the machine
```

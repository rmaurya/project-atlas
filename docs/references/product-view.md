# Several repositories, one product

Most of this tool is about one repository. This page is about the case where the thing you are working on is
**a product spread across sibling checkouts** — and where the directory holding them is not a repository at
all.

`atlas product` is the surface for that case. It is not the launcher: `atlas serve --launcher` knows ports,
this knows repositories.

---

## 1. The shape, and why the rest of the tool goes quiet in it

The case this was built for is thirteen independent checkouts under one plain directory:

```
UtilityServer/                  ← not a git repository, and not going to be one
  angular-gui/                  ← thirteen independent checkouts
  botfeed/
  cf-worker-browser-render/
  …
  utility-server-edge/          ← the only one that has adopted atlas
  docs/ARCHITECTURE.md          ← describes the product; belongs to no repository
  docs/INTERCONNECTIONS.md
  docs/REPOSITORIES.md
```

Two things follow from that layout, and both are the reason this command exists.

**A session is often run from the parent.** That is the ordinary way to work on something like this — one
editor window over the whole product, the work happening in a child. Every hook this tool ships opens with:

```bash
root=$(git rev-parse --show-toplevel) || exit 0
```

From the parent that fails, so the hook exits 0 and does nothing: no task recording, no rebuild on write, no
dashboard announcement. **From that directory the tool is, in effect, switched off**, and `atlas product` is
the one surface designed to be run there.

**Twelve of the thirteen have never adopted the tool.** A view that showed only the adopted one would report
a one-repository product — the same omitted-panel failure this project has shipped three times. So an
unadopted member is a **stated row** carrying what adoption would take, never a gap.

---

## 2. Discovery

A product root is **a directory that is not itself a git repository, and whose immediate children include at
least two that are.** Members are every immediate child holding a `.git` (a file counts — that is how
worktrees and submodules present).

Nothing is declared and there is no member list to maintain. A list is a document that goes stale, which is
the failure this whole tool detects; and it would have to live in a file that is never committed, so it would
not survive a cleanup either.

**Run from inside a member, the command does not go looking upward.** Ascending until a directory smells like
a product is a guess about somebody's filesystem, and a wrong guess renders a page about repositories nobody
asked about. It names the parent it can see and the flag that would use it:

```bash
atlas product --product /path/to/the/directory/holding/them
```

---

## 3. Where the page goes, and why not the obvious place

```
~/.claude/atlas/products/<name>-<hash>/product.html
```

Beside the machine-wide server registry `atlas serve` already keeps there.

The obvious alternative is the product directory itself: it is where you are standing, and it is not a git
repository, so nothing written there *can* be committed. **That last clause is exactly why it loses.** It is
true today and true by accident — one `git init` in a folder holding thirteen related projects, which is an
entirely reasonable thing for somebody to do, turns every product page ever written there into a tracked
file. A guarantee that can be revoked by a command somebody else runs is not a guarantee.

`~/.claude/` is not below the product root at all, so no operation performed on the product can bring the
page inside one. The cost is discoverability, and it is paid by printing the absolute path on every run.

`--out` is refused for any destination at or inside a member, or inside the product root. The refusal is an
error, not a warning.

---

## 4. What each row says

| Member state | The row carries |
|---|---|
| **adopted** | branch, uncommitted file count, last commit, plan progress from its own planning source, and its dashboard URL — the port is derived from the path, so the link is right for that checkout whether or not a server is up |
| **not adopted** | the same git facts, the number of markdown files adoption would index, and the one command that adopts it |
| **unreadable** | the reason, stated. A dropped row is indistinguishable from a repository that is not there |

---

## 5. What it costs, and the one thing it will not buy for you

Per member, by default: **one `existsSync`, one config parse, one plan file, three git commands.** Nothing is
built, nothing is indexed, no corpus is walked — except a depth-bounded markdown count on members that have
not adopted, which is the number that makes "not adopted" actionable. Thirteen members is about forty short
git invocations; it draws in well under a second.

**Health is the exception, and it is not measured by default.** Measuring it means indexing every member's
whole corpus — thirteen full builds to draw one page. So the page says *health was not measured*, in those
words, rather than leaving a blank that reads as a clean bill:

```bash
atlas product --deep      # index every adopted member and evaluate its signals; costs real time
```

---

## 6. Read-only across members, and how that is enforced rather than promised

- Every read is a file read or one of five allow-listed git subcommands, each passed
  `--no-optional-locks`. That flag is load-bearing: a bare `git status` refreshes and **rewrites
  `.git/index`**, which is a write into somebody else's repository.
- The module makes exactly one write, through one function, and that function refuses any destination at or
  inside a member — resolving symlinks on both sides, because a lexical check is walked past by a link.
- The suite snapshots every file under every member, including `.git`, before and after drawing the page and
  asserts they are byte-identical. Removing `--no-optional-locks` fails it on `.git/index`.

If a member needs building, that is `atlas build` **in that member**, run deliberately. This page never does
it on your behalf.

---

## 7. The product-level documents

`ARCHITECTURE.md`, `INTERCONNECTIONS.md`, `REPOSITORIES.md` and anything else at the product level are
**named and counted, and deliberately not indexed**.

Indexing them is a genuinely useful feature and the wrong one here. Everything this tool renders is derived
from a source under version control and re-derivable from it. That corpus has no repository to be derived
*from* — so an indexed copy, living in a page that is never committed and is safe to delete, would become the
most durable copy of a document with no history at all. That inverts the relationship the whole tool depends
on.

So it is reported as a finding instead: *these documents describe the product and are committed to no
repository.* That is the product-level orphan, it is true, and it is the thing you can act on. The remedy is
a home for them — a repository at the product level, or the member each one actually describes.

---

## 8. What the page cannot know

- **Whether a dashboard is answering.** A port is a pure function of a repository path, so the links stay
  correct for those checkouts; whether a server is up right now is a different question and the page does not
  pretend to answer it.
- **Anything with a clock in it.** There is no timestamp on the page, on purpose: the output is
  byte-identical for an unchanged product, so a diff of it means the product changed rather than that
  somebody re-ran the command.

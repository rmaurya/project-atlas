<!-- class: title -->
# project-atlas

**A derived, auditable knowledgebase over your repository's own documentation.**

Zero dependencies · Node ≥ 18 · one optional network call

<!-- notes: The deck is a markdown file like everything else here. If a slide is wrong, fix the markdown — there is no generate-me-a-deck path, because that would be the unreviewed generated prose this design refuses. -->

---

<!-- class: section -->
# The one rule everything else follows

---

# Your markdown is the source of truth

Everything project-atlas produces is **derived**.

- The index, the dashboard, the deck, the health report — all regenerated from your files
- Delete the output directory at any time; nothing is lost
- The tool never writes prose. It reports, and the words stay yours

<!-- notes: This is the test for every feature. If a change would make the tool author prose, or make the output the thing you edit, it does not belong. -->

---

# Why it exists

Documentation rots **mechanically**, in ways a machine can see:

- a link that points at a file that was renamed
- a citation naming a line that no longer exists
- two documents claiming the same title, one of them a fork nobody meant to make
- a document nothing links to, reachable only by knowing it is there

None of that needs judgement. All of it goes unnoticed.

---

<!-- class: section -->
# What it does

---

# Nine rot signals

| | |
|---|---|
| **H1** | Dead internal link |
| **H2** | Unresolvable code citation |
| **H3** | Duplicate title |
| **H4** | Orphan |
| **H5** | Unclassified |
| **H6** | Stale against its citations |
| **H7** | Forbidden term |
| **H8** | Missing title |
| **H9** | Cross-reference asymmetry |

**Blocking** signals have no legitimate cause. **Advisory** ones do — an archived record *should* cite code that has since moved.

<!-- notes: The blocking/advisory split is the whole design of the gate. Enforce only what has no legitimate exception; leave the rest to someone who can think. -->

---

# What it produces

- **Index** — every document, clustered, with client-side full-text search
- **Document pages** — rendered markdown with a table of contents and backlinks
- **Dashboard** — progress by track, health signals, a sortable item table
- **Role views** — QC, product, delivery, architecture, developer, executive
- **Health report** — every signal, with the reason each finding fired

---

# It publishes where you already work

```
atlas publish --target wiki     # flattened markdown, links rewritten, drift-guarded
atlas publish --target pages    # the full site to a gh-pages branch
atlas publish --target export   # one self-contained HTML file
```

**Nothing is pushed without `--push`.** Every target stages first.

---

<!-- class: section -->
# The rules it holds itself to

---

# Honesty, enforced in the output

- A figure that was **estimated** says so, next to the figure
- A check that **did not run** is listed under *Not checked*, never omitted
- A **suppressed** finding carries a stated reason
- A **capped** analysis reports the cap — a sample presented as a total is a lie
- There is deliberately **no combined contribution score**

<!-- notes: Every one of these exists because the alternative was tried and read as more confident than the data supported. -->

---

<!-- class: title -->
# The markdown is the source of truth

Everything else is derived, and safe to delete.

`atlas init` · `atlas scan` · `atlas health` · `atlas build`

---
description: Review documentation changes before committing — what this diff breaks or fixes. Use before a commit that touches docs, or when the user types /atlas:review.
disable-model-invocation: true
---

# Changed documents

!`out=$(git diff --stat HEAD -- '*.md' 2>/dev/null); st=$?; if [ -n "$out" ]; then printf '%s\n' "$out" | tail -20; elif [ $st -ne 0 ]; then echo "(git diff did not run — not a git repository, or no commits yet)"; else echo "(no unstaged markdown changes)"; fi; echo "--- staged ---"; out=$(git diff --cached --stat -- '*.md' 2>/dev/null); st=$?; if [ -n "$out" ]; then printf '%s\n' "$out" | tail -20; elif [ $st -ne 0 ]; then echo "(git diff --cached did not run)"; else echo "(nothing staged)"; fi`

# Health now

!`out=$(atlas health --no-color 2>/dev/null); if [ -n "$out" ]; then printf '%s\n' "$out" | head -16; else echo "(atlas health produced nothing — no config, not a git repository, or no atlas on PATH. Nothing below has been checked.)"; fi`

# Branch

!`out=$(atlas branch 2>/dev/null); if [ -n "$out" ]; then printf '%s\n' "$out" | head -4; else echo "(atlas branch produced nothing — no atlas on PATH, or not a git repository)"; fi`

---

Review the documentation changes in this working tree.

**Lead with what this diff *changed about the report*** — findings introduced or resolved. A full health dump
is not a review; the user can run `atlas:health` for that.

Check, in order:

1. **New blocking findings.** A dead link or a duplicate title introduced by this diff must be fixed before
   committing, not after.
2. **Claims about code.** Does the diff assert something about the source? Was it **verified this session** by
   reading the file, or carried over from an existing document? Documents lag code; an unverified claim
   inherited from another document is not evidence.
3. **Citations.** Full paths, not bare filenames — a bare name that exists twice cannot be verified at all.
4. **Dates.** Did a revised page get its date re-stamped? An undated page is one that will be trusted after it
   stops being true.
5. **Duplication.** Does this restate something that already exists? That is how forks start.
6. **Branch.** If the branch check reports a block, say so first — the user is about to commit to a protected
   branch.

**Be specific and be brief.** "The new section in `docs/auth.md` cites `src/auth.ts:88`, which has 61 lines"
is a review. "Looks good" is not, and neither is a list of everything that is fine.

If the diff is clean, say so in one line and stop.

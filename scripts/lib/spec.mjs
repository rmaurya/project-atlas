/**
 * project-atlas · a shipped change names the item it advances
 *
 * The roadmap in this repository went stale for 35 commits, was rewritten with a paragraph explaining how it
 * had gone stale, and then went stale again across the next six releases. Both times the dashboard printed
 * the evidence on its front page — *Spec to build — named by a commit: 0 of 20* — and both times nobody read
 * it. The plan was maintained by remembering, and remembering does not work.
 *
 * This is the same gate as `release.mjs`, pointed at the plan instead of the version: **if a shipped file
 * changed, the commit says which item it advances.** It is deliberately the weakest useful rule.
 *
 * ## What it refuses to do
 *
 * It does not check that the item's percentage moved, and it never will. A machine cannot know whether
 * `D-6` went from 0% to 40%, and a gate that guessed would either be wrong or would train people to type a
 * number to get past it. What it can enforce is that the plan was *opened* — that the author looked at the
 * list, chose an item, and named it. Every judgement after that belongs to a person.
 *
 * This is the same compromise the health report makes between blocking and advisory signals: enforce the
 * thing with no legitimate exception, and leave the rest to someone who can think.
 *
 * ## And it is now the *advisory* side of that compromise
 *
 * A verdict from here is `ok: false`, and the commit hook turns that into a **warning**, not a refusal.
 * Naming the item your change advances is a process SOP — a claim about how work is organised — and the
 * blocking set is reserved for claims that the repository itself is wrong: a dead link, a duplicate title, a
 * missing H1. `hooks/on-commit.sh` holds that line and explains what it cost to learn it. A repository that
 * wants the old strictness sets `branching.sopGate: "enforce"`.
 */

import { isRuntimePath } from './release.mjs';

/** `C-1`, `D-10`, `I-2`. Deliberately narrow: a bare number or a date must not read as an item. */
const ITEM_RE = /\b([A-Z]{1,2}-\d{1,3})\b/g;

/** Every item id named anywhere in a commit message, in order, deduplicated. */
export function idsIn(text) {
  return [...new Set([...String(text ?? '').matchAll(ITEM_RE)].map((m) => m[1]))];
}

/**
 * The verdict.
 *
 * `message` is `null` when it could not be read — `git commit -F -` takes the message on stdin, where a
 * PreToolUse hook cannot see it. **That case is reported and does not refuse.** It used to refuse, on the
 * argument that a check which cannot run must never report success. Half of that is still right and is kept:
 * this says plainly that nothing was checked. The other half was wrong in a way that cost a live session an
 * afternoon — see `pending` below — because *the operator had done nothing wrong*. The finding is about the
 * gate's own reach, not about the commit, and a guard that refuses work over its own blind spots is a guard
 * that gets switched off, after which nothing is checked at all.
 */
/**
 * Why the message could not be read, and what to actually do about it.
 *
 * There was one line here for all three causes, and it named stdin. That is right for exactly one of them
 * and actively misleading for the others: a commit written as `-F "$MSG/file.txt"` was told *"a hook
 * cannot see a message passed on stdin — use `-m` or `-F <file>`"*, which is advice to do the thing that had
 * just been done. A guard is trusted, so a guard that misdiagnoses costs more than one that says nothing —
 * the reader stops looking at the real cause.
 */
const UNREADABLE = {
  stdin:
    '  The message was passed on stdin (`git commit -F -`), where a PreToolUse hook cannot see it.\n' +
    '  Write it to a file first, then `git commit -F <file>`.',
  pending:
    '  The `-F <path>` names a file that the same command line writes — `cat > msg.txt && git commit -F\n' +
    '  msg.txt`. A PreToolUse hook runs *before* the shell does, so at the moment of this check the file\n' +
    '  structurally cannot exist yet, and nothing about the commit needs changing to fix that.',
  unexpanded:
    '  A `-F <path>` was given with a variable or `~` in it. The hook sees the command before the shell\n' +
    '  expands it, so the path is still literal text at that point. Pass it as a literal path if you want\n' +
    '  this gate to be able to read the message.',
  unresolved:
    '  A `-F <path>` was given but the path could not be opened, and nothing in the command writes it.\n' +
    '  Check the path, or use `-m "…"`.',
  absent:
    '  Neither `-m` nor `-F` was given, so the message would have come from an editor the hook cannot read.\n' +
    '  Use `-m "…"` or `-F <file>` so the gate can see which item this advances.',
};

export function specVerdict({ changed = [], message, items = [], roadmapPath = null, whyUnreadable = 'absent' }) {
  const runtime = changed.filter((p) => isRuntimePath(p));
  if (!runtime.length) {
    return { ok: true, message: 'No shipped file changed — no item needs naming.' };
  }

  const known = new Map(items.map((i) => [i.id, i]));
  const open = items.filter((i) => (i.percent ?? 0) < 100);

  if (message === null || message === undefined) {
    // An unknown reason falls back to the general one rather than printing `undefined` into a guard's
    // output. The reason is passed in as a string by a shell script, which is exactly the kind of input
    // that arrives misspelled once.
    return {
      ok: false,
      unreadable: whyUnreadable in UNREADABLE ? whyUnreadable : 'absent',
      message:
        `${runtime.length} shipped file(s) changed and the commit message could not be read, so nothing was checked.\n` +
        (UNREADABLE[whyUnreadable] || UNREADABLE.absent) + '\n' +
        `  Nothing is wrong with the commit. This says only that the gate could not see the message.`,
    };
  }

  const named = idsIn(message).filter((id) => known.has(id));
  if (named.length) {
    const touchedPlan = roadmapPath ? changed.includes(roadmapPath) : true;
    return {
      ok: true,
      named,
      message: `Advances ${named.join(', ')}${touchedPlan ? '' : ` — the plan itself was not edited, so the figures still say what they said before.`}`,
    };
  }

  const shown = open.slice(0, 12)
    .map((i) => `  ${i.id.padEnd(5)} ${String(i.percent ?? 0).padStart(3)}%  ${i.title}`)
    .join('\n');

  return {
    ok: false,
    message:
      `${runtime.length} shipped file(s) changed and the commit names no roadmap item.\n\n` +
      `  Work that names nothing is work the plan cannot see: this repository shipped 35 commits and then\n` +
      `  six releases that way, and the dashboard reported "named by a commit: 0" throughout.\n\n` +
      `${shown}${open.length > 12 ? `\n  … and ${open.length - 12} more` : ''}\n\n` +
      `  Name one in the subject or body — "fix(export): … (D-9)" — or set automation.specOnCommit to false.`,
  };
}

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
 * PreToolUse hook cannot see it. That case **refuses**. A gate that waves through every commit whose message
 * it failed to parse is a gate that is off, and the whole argument of this project is that a check which
 * cannot run must never report success.
 */
export function specVerdict({ changed = [], message, items = [], roadmapPath = null }) {
  const runtime = changed.filter((p) => isRuntimePath(p));
  if (!runtime.length) {
    return { ok: true, message: 'No shipped file changed — no item needs naming.' };
  }

  const known = new Map(items.map((i) => [i.id, i]));
  const open = items.filter((i) => (i.percent ?? 0) < 100);

  if (message === null || message === undefined) {
    return {
      ok: false,
      message:
        `${runtime.length} shipped file(s) changed and the commit message could not be read, so nothing was checked.\n` +
        `  A PreToolUse hook cannot see a message passed on stdin (\`git commit -F -\`).\n` +
        `  Use \`-m "…"\` or \`-F <file>\` so the plan gate can see which item this advances.`,
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

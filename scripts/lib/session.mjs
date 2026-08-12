/**
 * Pause, resume and stop — the state of the work, not the state of the documents. (A-32)
 *
 * Everything else in this tool derives from files that are still there when you come back. This module exists
 * for the one thing that is not: **an agent that was mid-task when the session ended.** Three of them were,
 * once. Their branches, their worktrees and 92K of uncommitted work in one of them survived only because
 * somebody went and looked, by hand, at `git worktree list` and three `git diff HEAD`s. The most expensive
 * thing this tool touches was the only thing with no record.
 *
 * ## Git is the store
 *
 * `pause` commits each dirty worktree to a `wip/agent-<id>` ref rather than writing a patch under `.atlas/`.
 * A patch file dies with the disk, and losing the disk is exactly the situation you reach for this in. A
 * commit survives a reboot, a re-clone and a cleared scratchpad, and `git` — not this module — is then
 * responsible for the bytes. The cost is honest and stated at the prompt: it leaves commits you will want to
 * squash.
 *
 * ## What `resume` refuses to claim
 *
 * A subagent's context lives in the process that ran it and dies with that process. Nothing written here can
 * reconstitute its reasoning. A command that printed "resumed" while quietly starting a *fresh* agent on an
 * old brief would be the most expensive lie this tool could tell — it would look like continuation and behave
 * like amnesia, and the operator would only find out after paying for it twice.
 *
 * So `resume` restores what is restorable — the branch, the worktree, the diff, the label, what was
 * established — and hands back a **plan for the session to act on**. The distinction is stated in the output
 * every time, not buried in documentation.
 *
 * ## The manifest carries labels, never prompts
 *
 * The transcript sidecar `agent-<id>.meta.json` holds `description`: a three-word title such as
 * "Economics dashboard view". That is what is stored. It is not the brief, and the brief is not read — the
 * same boundary `tokens.mjs` holds over the same directory, for the same reason. `.atlas/parked.json` is
 * gitignored regardless, because state about *how you were working* is not a fact about the repository.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PARKED_FILE = '.atlas/parked.json';
export const WIP_PREFIX = 'wip/agent-';

/** Never throws for an expected git condition; a missing repository is a state this module reports. */
function git(root, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${String(err?.stderr || err.message).split('\n')[0]}`);
  }
}

/**
 * Every worktree of this repository, main checkout included.
 *
 * Parsed from `--porcelain` rather than the human format: a path with a space in it is not hypothetical on
 * macOS, and the columnar output cannot be split safely.
 */
export function worktrees(root) {
  const out = git(root, ['worktree', 'list', '--porcelain'], { allowFail: true });
  if (out === null) return [];
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) list.push(cur);
      cur = { dir: line.slice(9), branch: null, head: null, detached: false, locked: false };
    } else if (line.startsWith('HEAD ') && cur) cur.head = line.slice(5);
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached' && cur) cur.detached = true;
    else if (line.startsWith('locked') && cur) cur.locked = true;
  }
  if (cur) list.push(cur);
  return list;
}

/** An agent worktree is one this harness made: `.claude/worktrees/agent-<id>`. */
export function agentIdOf(dir) {
  const m = /(?:^|[/\\])agent-([A-Za-z0-9_-]+)$/.exec(dir);
  return m ? m[1] : null;
}

function dirtyCount(dir) {
  const out = git(dir, ['status', '--porcelain'], { allowFail: true });
  if (out === null) return null;
  return out ? out.split('\n').filter(Boolean).length : 0;
}

/**
 * The agent's own short label, read from the transcript sidecar.
 *
 * `description` only — a title, not the brief. Returns null rather than guessing, and a missing store is not
 * an error: a worktree can outlive the transcript that created it.
 */
export function agentLabel(storeDir, id) {
  if (!storeDir || !fs.existsSync(storeDir)) return null;
  let sessions;
  try { sessions = fs.readdirSync(storeDir, { withFileTypes: true }); } catch { return null; }
  for (const s of sessions) {
    if (!s.isDirectory()) continue;
    const f = path.join(storeDir, s.name, 'subagents', `agent-${id}.meta.json`);
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      // `description` is the 3-5 word title. `prompt` is deliberately not read, and would not be stored.
      return typeof j.description === 'string' ? j.description : null;
    } catch { return null; }
  }
  return null;
}

/**
 * Park every worktree that has uncommitted work.
 *
 * Returns a report rather than printing one — the CLI owns presentation, and the tests read the report.
 * `dryRun` answers "what would this do" without writing, which is the only safe way to try a command whose
 * whole job is to touch every worktree you have.
 */
export function pauseSession(root, opts = {}) {
  const { storeDir = null, dryRun = false, now = null, label = null } = opts;
  const stamp = now || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const trees = worktrees(root);
  if (!trees.length) {
    return { available: false, reason: 'Not a git repository, so there are no worktrees to park.', agents: [] };
  }

  /*
   * Compared as real paths, never as strings. On macOS the system temp directory is a symlink, so `git
   * worktree list` reports `/private/var/…` for a root the caller knows as `/var/…`. A `===` here silently
   * failed to recognise the main checkout, which meant `pause` treated the operator's own repository as an
   * unknown worktree — the one tree it must never commit on.
   */
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const rootReal = real(root);

  const agents = [];
  for (const w of trees) {
    const id = agentIdOf(w.dir) || (real(w.dir) === rootReal ? '(main)' : null);
    if (!id) continue;
    if (!fs.existsSync(w.dir)) continue;
    const dirty = dirtyCount(w.dir);
    if (dirty === null) continue;

    const rec = {
      id,
      isMain: id === '(main)',
      dir: w.dir,
      branch: w.branch,
      label: id === '(main)' ? null : agentLabel(storeDir, id),
      dirty,
      wipRef: null,
      committed: 0,
      note: null,
    };

    if (dirty > 0 && !rec.isMain) {
      const ref = `${WIP_PREFIX}${id}`;
      if (dryRun) {
        rec.wipRef = ref;
        rec.note = 'would commit';
      } else {
        try {
          git(w.dir, ['add', '-A']);
          // `--allow-empty` is deliberately NOT passed: if `add -A` staged nothing (everything was ignored),
          // there is no work here and inventing a commit would put a lie in the log.
          const staged = git(w.dir, ['diff', '--cached', '--name-only'], { allowFail: true }) || '';
          if (!staged.trim()) {
            git(w.dir, ['reset', '-q'], { allowFail: true });
            rec.note = 'nothing but ignored files; not committed';
          } else {
            const msg = `wip(atlas): parked by atlas pause at ${stamp}\n\n` +
              'Committed by `atlas pause` so the work survives the session that was doing it (A-32).\n' +
              'This is a checkpoint, not a finished change — squash or amend it before it lands.';
            git(w.dir, ['commit', '-q', '--no-verify', '-m', msg]);
            rec.wipRef = ref;
            rec.committed = staged.trim().split('\n').length;
            // The branch marker is a ref, so the checkpoint is findable even if HEAD moves on.
            git(w.dir, ['branch', '-f', ref, 'HEAD'], { allowFail: true });
          }
        } catch (err) {
          rec.note = `could not park: ${err.message}`;
        }
      }
    } else if (dirty === 0) {
      rec.note = 'clean';
    } else if (rec.isMain) {
      rec.note = 'main checkout left alone — pause parks agents, not your own edits';
    }

    // Whatever it has committed that trunk does not, so `resume` can say what was achieved.
    const ahead = git(w.dir, ['rev-list', '--count', `main..HEAD`], { allowFail: true });
    rec.commitsAhead = ahead === null ? null : Number(ahead);
    agents.push(rec);
  }

  const parked = {
    version: 1,
    at: stamp,
    label: label || null,
    root,
    agents,
  };
  if (!dryRun) writeParked(root, parked);
  // `dryRun` is returned rather than only consumed: the caller renders a different headline for a rehearsal,
  // and a report that cannot say whether it actually did anything is a report you have to guess at.
  return { available: true, reason: null, dryRun, ...parked };
}

export function writeParked(root, parked) {
  const f = path.join(root, PARKED_FILE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(parked, null, 2)}\n`, 'utf8');
  return f;
}

export function readParked(root) {
  const f = path.join(root, PARKED_FILE);
  if (!fs.existsSync(f)) {
    return { available: false, reason: 'Nothing is parked. `atlas pause` writes this file; `atlas resume` reads it.' };
  }
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!j || typeof j !== 'object' || !Array.isArray(j.agents)) {
      return { available: false, reason: `${PARKED_FILE} is not a parked-session manifest.` };
    }
    return { available: true, reason: null, ...j };
  } catch (err) {
    // A torn manifest is reported, never silently treated as "nothing was parked" — that reading would
    // tell somebody their work is gone when it is sitting in a wip ref.
    return {
      available: false,
      reason: `${PARKED_FILE} could not be read (${err.message}). Any parked work is still on its ` +
        `\`${WIP_PREFIX}*\` branch — \`git branch --list '${WIP_PREFIX}*'\` will list it.`,
    };
  }
}

/**
 * Re-verify the manifest against the tree before believing it.
 *
 * A manifest is a claim about the past; the worktree is the present. They diverge — somebody deletes a
 * worktree, or lands a branch, between pausing and resuming. `resume` states which records still hold.
 */
export function verifyParked(root, parked) {
  const live = new Map(worktrees(root).map((w) => [w.dir, w]));
  return (parked.agents || []).map((a) => {
    const present = fs.existsSync(a.dir) && live.has(a.dir);
    const refExists = a.wipRef
      ? git(root, ['rev-parse', '--verify', '-q', a.wipRef], { allowFail: true }) !== null
      : null;
    return { ...a, worktreePresent: present, wipRefPresent: refExists };
  });
}

/**
 * Clear the session state. Branches and commits are never touched.
 *
 * Refuses on a dirty worktree unless forced, because "stop" means *finish cleanly* and deleting somebody's
 * uncommitted work on the way past is the opposite of that. The suggestion in the refusal is `atlas pause`,
 * which is the command that makes stopping safe.
 */
export function stopSession(root, opts = {}) {
  const { force = false, dryRun = false } = opts;
  const trees = worktrees(root);
  const removed = [];
  const kept = [];

  for (const w of trees) {
    const id = agentIdOf(w.dir);
    if (!id || w.dir === root) continue;
    const dirty = dirtyCount(w.dir);
    if (dirty === null) continue;
    if (dirty > 0 && !force) {
      kept.push({ id, dir: w.dir, dirty, why: 'has uncommitted work' });
      continue;
    }
    if (w.locked && !force) {
      kept.push({ id, dir: w.dir, dirty, why: 'locked' });
      continue;
    }
    if (!dryRun) {
      const args = ['worktree', 'remove', w.dir];
      if (force) args.push('--force');
      if (w.locked) git(root, ['worktree', 'unlock', w.dir], { allowFail: true });
      const r = git(root, args, { allowFail: true });
      if (r === null) { kept.push({ id, dir: w.dir, dirty, why: 'git refused to remove it' }); continue; }
    }
    removed.push({ id, dir: w.dir, dirty });
  }

  const f = path.join(root, PARKED_FILE);
  const hadManifest = fs.existsSync(f);
  if (hadManifest && !dryRun) fs.rmSync(f, { force: true });

  // Every wip ref is listed but never deleted: this command's promise is that nothing which reached git is
  // lost, and a checkpoint branch is the last copy of work somebody chose to keep.
  const wip = (git(root, ['branch', '--list', `${WIP_PREFIX}*`, '--format=%(refname:short)'], { allowFail: true }) || '')
    .split('\n').map((s) => s.trim()).filter(Boolean);

  return { removed, kept, hadManifest, wipRefs: wip, dryRun, forced: force };
}

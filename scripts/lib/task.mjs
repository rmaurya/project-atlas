/**
 * project-atlas · one atlas-shaped answer, for software that is not a terminal
 *
 * M-2 asked for software to drive a session: send instructions, take an update, send input, get output.
 * **MCP cannot do that** — there, a client calls tools and the server answers; nothing lets an outside
 * process start work or steer a run. The mechanisms that genuinely drive a session are the Claude Agent SDK
 * and headless `claude -p`, and neither belongs inside a documentation tool: a general-purpose agent runner
 * wearing this project's name would be a different product sharing a package.
 *
 * So this is the narrow version the roadmap describes, and the narrowness is the design. CI, a git hook, a
 * dashboard cron or an editor plugin wants one thing from atlas — *is the documentation sound, and what
 * exactly is wrong* — as a structured answer with an exit code, without a terminal and without parsing
 * output formatted for a human. That is a batch query, not a session, and it needs no agent at all.
 *
 * ## What this is not
 *
 * It does not start Claude, hold a conversation, accept mid-run input, or stream. Anything wanting that
 * should reach for the Agent SDK directly; atlas is the thing such a session would *call*, not the thing
 * that runs it. Saying so in the code is the point — the alternative is a half-built session driver that
 * looks like it will grow into one.
 *
 * ## Exit codes, because the caller is a program
 *
 *   0  the question was answered and nothing blocking was found
 *   1  answered, and something blocking was found — the case CI should fail on
 *   2  the question could not be answered (no repository, no config, unknown task)
 *
 * The distinction between 1 and 2 is the whole value. A tool that exits non-zero for both tells a pipeline
 * "documentation is broken" when the truth was "atlas could not run", and the second is a pipeline bug
 * while the first is a real finding.
 */

import { resolveConfig } from './config.mjs';
import { buildIndex } from './scan.mjs';
import { runHealth } from './health.mjs';
import { readPlanning } from './planning.mjs';
import { TOOLS } from './mcp.mjs';

/**
 * The tasks a program may ask for.
 *
 * Deliberately the same set the MCP server exposes, resolved through the same handlers: two surfaces
 * answering the same question differently is a drift generator, and this project exists to detect those.
 */
export const TASKS = Object.keys(TOOLS);

/**
 * Answer one task. Returns `{ ok, exitCode, task, data, error }` and never throws for the ordinary cases.
 *
 * `blocking` is lifted to the top level rather than left inside the payload: a caller deciding whether to
 * fail a build should not have to know the shape of a health report to find the one number that matters.
 */
export function runTask(root, task, args = {}) {
  if (!TASKS.includes(task)) {
    return {
      ok: false, exitCode: 2, task,
      error: `Unknown task "${task}". One of: ${TASKS.join(', ')}`,
    };
  }

  let cfg;
  try {
    cfg = resolveConfig(root);
  } catch (e) {
    // A malformed config is a caller problem, not a documentation finding — exit 2, not 1.
    return { ok: false, exitCode: 2, task, error: `Configuration could not be read: ${e.message}` };
  }

  // **A directory that never adopted the tool is not a corpus, and answering as though it were is the worst
  // available outcome.** Pointed at a directory with no config, this happily scanned everything beneath it
  // and reported 1,389 findings — a number a CI job would have failed on, about files that were never
  // documentation. Refusing with exit 2 says "I could not answer"; the alternative says "your docs are
  // broken", which is both false and actionable, the two properties that make a wrong answer expensive.
  if (!cfg.__configPath) {
    return {
      ok: false, exitCode: 2, task,
      error: `No project-atlas.config.json at or above ${root} — nothing here has adopted the tool, so ` +
             `there is no corpus to answer about. Run \`atlas init\` first.`,
    };
  }

  try {
    const data = TOOLS[task].run({ root, cfg, args });
    // Only the health task can find something blocking. Deriving the exit code from the payload rather than
    // from the task name means a task that grows a blocking notion later inherits this for free.
    const blocking = Number.isFinite(data?.blocking) ? data.blocking : 0;
    return { ok: true, exitCode: blocking > 0 ? 1 : 0, task, blocking, data };
  } catch (e) {
    return { ok: false, exitCode: 2, task, error: e.message };
  }
}

/** The whole answer as one JSON object, for a caller that will pipe it into something else. */
export function formatTask(result) {
  return JSON.stringify(
    result.ok
      ? { ok: true, task: result.task, blocking: result.blocking, data: result.data }
      : { ok: false, task: result.task, error: result.error },
    null, 2);
}

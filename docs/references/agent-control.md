# Driving sessions from outside

How an external orchestrator runs Claude Code against a repository, why that orchestrator is **not** part of
this tool, and the safety contract it has to hold up for the boundary in [`autonomy.md`](autonomy.md) to mean
anything once nobody is watching.

**Date:** 2026-08-11 · **Status:** design, not built here · **Plan item:** M-3

## The direction mistake, stated once

**An MCP server cannot drive a Claude Code session.** The protocol runs client → server: a server publishes
tools, and a *client* decides whether to call them. Claude Code is the client. `atlas mcp` is a thing it
calls. Nothing a server can send starts work, steers a run, or answers a question — there is no sampling or
elicitation escape hatch that reverses the arrow.

This is written down because the request arrives in good faith and sounds reasonable: *give the MCP server
full control so the orchestrator can drive development through it.* Built literally, that produces a corpus
server with its read-only guarantee deleted and none of the control anyone wanted — the failure
`scripts/lib/mcp.mjs` names in its own header as "how you build the wrong thing convincingly".

The capability exists. It is a different surface.

## Two planes, each pointed the right way

```
   TUHI (orchestrator)  ──drives──▶  Claude Agent SDK  ──runs──▶  Claude Code session
          ▲                                                              │
          └──────────── progress, questions, permission asks ────────────┤
                                                                         │ calls
                                                          atlas mcp ◀────┘
                                                       (read-only corpus)
```

**Control plane — the Agent SDK.** `@anthropic-ai/claude-agent-sdk` is Claude Code as a library: the agent
loop, the built-in tools, hooks, permissions and sessions. The orchestrator calls `query(prompt, options)`
and consumes a typed message stream. TypeScript and Python only; other languages are told to shell out to
the CLI, which is a wrapper story rather than an orchestration one.

**Knowledge plane — this tool's MCP server.** Sessions the orchestrator drives configure MCP servers through
`options.mcpServers`, so the corpus stays queryable from inside a driven run **without the server acquiring
any ability to drive one**. The read-only guarantee and the test that enforces it are untouched. That is the
whole reason the two planes stay separate: widening the corpus server to gain control would have cost the
guarantee and bought nothing.

## Why the orchestrator is not built here

M-2 settled this and the answer has not changed: *a general-purpose agent runner inside a documentation tool
would be two products sharing a package.* The tool's founding rule is that everything it produces is derived
from the repository's own markdown and is safe to delete. A session driver is neither derived nor deletable —
it is a long-lived process with credentials that makes changes for you.

So this document is the boundary, not the implementation. What lives here is the **contract**: what a driver
must guarantee before this project is willing to say its autonomy story survives being automated.

## The four capabilities, and the one that is easy to get wrong

| Requirement | Mechanism |
|---|---|
| Send a prompt, start work | `query(prompt, options)`; one process can hold many concurrent sessions |
| Monitor progress | Typed messages — tool-use blocks arrive **before** execution, results after; raw token deltas behind `includePartialMessages` |
| Answer a question mid-run | The `canUseTool` callback, with `toolName === "AskUserQuestion"` |
| Steer a run already in progress | **Streaming input mode** — see below |

**Streaming input is the one that decides whether the design works.** Passing a string to `query` is
turn-based: the run goes until it finishes and nothing can be injected. Passing an **async generator**
instead lets the driver yield further messages into a session *while the model is working*. Everything
people mean by "interact with it continuously" depends on that single choice, and the two modes look nearly
identical at the call site.

**Permission asks and Claude's own questions arrive through the same callback.** A question is a tool call
named `AskUserQuestion` carrying the options; the driver answers by returning the chosen label. Convenient,
and worth knowing before writing two separate handlers for what is one code path.

## The safety contract

The line in [`autonomy.md`](autonomy.md) is that autonomy is granted over derived state and never over
outward-facing actions: **push, wiki publish and Pages publish are refused, and that is not a configuration
option.** A driver that removes the human from the loop does not get to quietly relax it. Three requirements:

**1. The guard is a `PreToolUse` hook, not the permission callback.** This is the load-bearing detail.
`canUseTool` is **not invoked for auto-approved tools** — anything matching `allowedTools` or waved through
by the permission mode skips it entirely. A `git push` check implemented only there has a hole exactly where
it matters: the configuration that makes a run autonomous is the configuration that disables the check.
Hooks run **first** in the evaluation order and fire on every call, so the refusal belongs there. A deny rule
(`Bash(git push*)`) sits behind it as the second layer.

**2. Refusal is the default posture, not an exception list.** Prefer a tight `allowedTools` set under
`dontAsk` over a permissive mode plus prohibitions. The difference shows up on the tool nobody thought to
name.

**3. The guard is tested, and the test fails without it.** An untested refusal is a claim. This project's own
rule — a fix ships with a test that fails without the fix — applies with more force here than anywhere else
in the codebase, because the thing being asserted is that something *never* happens while nobody is looking.

**What cannot be constrained, stated so nobody assumes otherwise.** The SDK gates *actions*, not intent or
content. Tool calls can be blocked by name, by argument pattern and by path; file **contents** cannot be
filtered, tool output cannot be un-seen once a tool has run, and the model's reasoning is not a control
surface. There is also no pre-built unattended-safety framework and no documented account of what happens
when an autonomous run goes wrong — the building blocks are supplied and the composition is the integrator's
to own. Treat a driven run as something to bound and observe, not something to trust.

## What would have to be true before trusting it

- The push and publish refusals hold under a hook test that fails when the hook is removed.
- Every driven run is bounded: `maxTurns`, a cost ceiling, and a wall-clock timeout.
- Sessions are resumable by id, so an interrupted run can be inspected rather than restarted blind.
- The journal records what a driven session touched, in the same append-only form a human session uses.
- The corpus server it queries is still the read-only one, and its test still passes.

---
description: "MCP connection details for this repository — the server and protocol version, the tools it exposes, whether any client here is registered to spawn it, the config snippet to connect one, and which server processes are running. Use when the user asks about MCP, about connecting atlas to a client, about which clients are connected, or types /atlas:mcp."
disable-model-invocation: true
---

# MCP

!`atlas mcp --status`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "there is no server and nothing is connected".

---

`atlas mcp --status` has already run above. It prints nothing but facts it read: the protocol revision this
build implements, the tool set from the code, the client configs it opened on this machine, and the process
table. Nothing in it is inferred.

Report it in this order, and stop:

1. **What the server is** — `project-atlas <version>`, MCP over stdio, protocol version.
2. **Whether a client here can spawn it.** "Registered" is the honest word: a config names it, so a client
   *could* start one. If nothing is registered, say so and give the snippet.
3. **What is running**, and what that does and does not tell you.

## Direction, and the answer to "which clients are connected"

**This is the thing most often got wrong, and the report above is built around it.** An MCP server exposes
tools a *client* decides to call. On stdio there is no socket, no daemon and no connection pool: the client
spawns a process and owns both ends of its stdin and stdout, so **one process is one client for its whole
life**, and a server nobody spawned does not exist to be counted.

So when the user asks "which clients are connected":

- **Knowable, and in the block above** — which `atlas mcp` processes are alive, how long each has run, the
  parent process that spawned each one (that parent *is* the client), and which repository each was pointed
  at with `--root`.
- **Not knowable from here** — whether a live process has completed a handshake or is sitting idle, which
  tools a client has ever called, and anything about a client on another machine.

**Never report "0 clients connected".** It describes a connection pool this server does not have, and it
reads as "nothing uses this" when the truth is "nothing is using it at this instant, and a registered client
would spawn one the moment it needed to". Say *no server process is running right now* and, separately,
whether anything is registered to start one.

## Reading the block above

- **Registered: yes** — name the client and scope, and check the two lines under it. "Serves a different
  repository" and "a different copy of atlas" both mean the registration works and answers about something
  else, which is worse than not being registered at all. Lead with either if it appears.
- **Registered: no** — give the snippet from the block verbatim, with the absolute paths it printed. Do not
  retype the path from memory and do not shorten it to `atlas`; a bare command resolves off the client's
  `PATH`, which is how a client ends up talking to a different build.
- **`not checked` rows** — a location this build does not read, or a config that would not parse. A check
  that could not run is never a check that passed: if the only `no` is sitting next to an unreadable file,
  say the answer is unknown for that file rather than repeating "not registered".
- **A running process whose client is `reparented to init`** — whatever spawned it has exited and the
  process is an orphan holding no conversation. `kill <pid>` is the fix; offer it, do not run it.

## What not to do

- **Do not run `atlas mcp` to "check it works".** With no client on the other end it waits forever on stdin
  and looks exactly like a hang. `--status` is the way to inspect it, which is why it exists.
- **Do not write the config file yourself** unless the user asks for it. Registering a server changes what
  their client launches; show the snippet and let them place it.
- **Do not describe the tools as things atlas can do to a session.** Every one of them reads — health, the
  plan, search, changes, contributions, the design record, the journal. Nothing here starts work, steers a
  run or reads a transcript, and the surface is read-only by construction.

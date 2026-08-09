---
description: List every project-atlas command and what this repository's current state is. Use when the user asks what they can do, how to start, or types /atlas:help.
disable-model-invocation: true
---

# Commands

!`ls -1 "${CLAUDE_PLUGIN_ROOT:-.}/skills" 2>/dev/null | sed 's/^/  atlas:/'`

## This repository right now

!`atlas caps --offline 2>/dev/null | head -3; echo "---"; atlas scan 2>/dev/null | head -3 || echo "not indexed yet — no config, or not a git repository"`

---

Present the command list above with **one line each**, written from what each skill's `description` frontmatter
actually says — read them, do not recite from memory. This page must never list a command that no longer
exists, or omit one that does; that is why the list is read from disk rather than typed here.

Then say **what to run first**, based on the state shown above:

- **No config** → `atlas init`, then `atlas scan`. Explain that nothing existing is modified.
- **Configured but never built** → `atlas health` then `atlas build`.
- **Built already** → point at the delta: what changed since the last run.

Keep it to a screen. This is the answer to *"what can I do here?"*, not a flag reference — `atlas --help`
covers flags, and say so once at the end rather than reproducing them.

If the user asked about something specific (publishing, a signal, configuring), skip the tour and route them
straight to the one command that answers it.

#!/bin/sh
# project-atlas · commit guard
#
# Three checks, and **two different verdicts** — which is the whole design.
#
#   1. atlas branch        — protected branch, or a name that does not follow type/short-slug   WARN
#   2. atlas health --gate — a dead link, a duplicate title, a missing H1 this commit would land BLOCK
#   3. atlas spec  --gate  — the commit names the plan item it advances                          WARN
#
# ## Why two verdicts, when this file used to have one
#
# The health gate makes a claim about the **repository**: this link resolves to nothing, these two documents
# both claim the same title. There is no legitimate exception, a person cannot reasonably disagree, and the
# commit would land known rot. That refuses.
#
# The other two make claims about **how somebody is working**: branch before you commit, name the item your
# change advances. Those are process SOPs. They are right, they are worth saying every time, and they are
# still somebody's judgement — the same line `health.mjs` already draws when it makes H17 advisory *because*
# "you should have parallelised" is a claim about a working method rather than about the corpus.
#
# The version of this file that refused on all three was actively obstructing a live session. Every refusal it
# printed opened with *"Safe to commit here. Branch follows the convention and is not protected"* — nothing was
# wrong with the repository — and then blocked because it could not read a commit message that **structurally
# could not exist yet**: a PreToolUse hook sees `cat > msg.txt && git commit -F msg.txt` before the shell runs
# it, so the file it is asked to read is written by the command it just refused. The retry then failed because
# the file was still missing. A loop with no exit, over a message the author had written correctly.
#
# **A guard people disable is worse than no guard**, and that is where this was heading. So a warning here has
# to earn its interruption: name the SOP, say why it exists, say what to do, and then get out of the way.
#
# ## When the guard itself fails
#
# It warns. It used to refuse — *"When a check cannot run, this refuses anyway and says so"* — and one of the
# refusals in that session was not a refusal at all but a crash (`Cannot read properties of null (reading
# 'missing')`), which cost the operator a blocked commit for a defect in this tool. "A check that did not run
# is never reported as having passed" is still true and still honoured: an unrunnable gate says loudly that it
# did not run. What it must not do is convert a defect in the guard into a refusal of somebody else's work.
#
# ## Exit codes, which are the mechanism
#
# **Exit 2 is the only code that stops the tool call and puts stderr in front of Claude.** Exit 1 is an
# ordinary command failure and the commit proceeds, which is how the first version of this hook printed eleven
# lines of refusal and then let the commit through. On exit 0 stderr goes only to the debug log — so a warning
# that were merely printed there would be a warning nobody ever reads. Warnings are therefore emitted as hook
# JSON on stdout (`systemMessage` for the person, `hookSpecificOutput.additionalContext` for the model) *and*
# on stderr for every other runtime and for the log.
#
# ## Switches
#
#   automation.healthOnCommit: false     stop gating commits on documentation rot
#   automation.specOnCommit:   false     stop asking a shipped change to name a plan item
#   branching.sopGate: "enforce"         refuse on the SOPs too, the way this hook behaved before
#   ATLAS_COMMIT_SOP=enforce|warn        the same switch for one command or one CI job
#
# It is inert in any repository with no config file, so installing the plugin does not start policing
# repositories that never adopted it.

payload=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
else
  cmd=$payload          # no jq: match against the raw payload, which over-matches rather than under-matches
fi

# Not a commit? Say nothing. This hook sees every Bash call.
printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])git[[:space:]]+commit' || exit 0

command -v jq >/dev/null 2>&1 || \
  echo 'project-atlas: jq was not found, so this matched the raw hook payload instead of .tool_input.command. Install jq for exact matching.' >&2

ATLAS="${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"

# **Judge the repository being committed in, not the one the session happens to be sitting in.**
#
# Every check below ran against the process cwd, which is the session's directory. Committing in a *second*
# repository — a sibling checkout, a worktree, anything reached with `cd` — therefore evaluated the wrong tree.
# Observed twice in one session: a commit in another project was refused because *this* repository was on a
# protected branch, and later because *this* repository had a blocking finding. Neither had anything to do
# with the commit being made, and the only way past it was to change branch in an unrelated project.
#
# The target comes from an explicit `cd <dir>` in the command when there is one, and otherwise from the
# payload's own `cwd`. Both are what the shell will actually use, so the guard and the commit agree on the
# subject. A directory that is not a repository, or one that never adopted this tool, leaves the guard inert —
# which it already promised to be, and now is across repository boundaries too.
target=$(printf '%s' "$cmd" | awk '
  match($0, /(^|[;&|][[:space:]]*)cd[[:space:]]+/) {
    s = substr($0, RSTART + RLENGTH)
    if (substr(s,1,1) == "\"")     { sub(/^"/,"",s);  sub(/".*/,"",s) }
    else if (substr(s,1,1) == "'"'"'") { sub(/^'"'"'/,"",s); sub(/'"'"'.*/,"",s) }
    else                            { sub(/[[:space:];&|].*/,"",s) }
    print s; exit
  }')
if [ -z "$target" ] && command -v jq >/dev/null 2>&1; then
  target=$(printf '%s' "$payload" | jq -r '.cwd // ""')
fi
ROOTARG=""
if [ -n "$target" ] && [ -d "$target" ]; then
  ROOTARG="--root $target"
fi

# The posture for the SOP half, read from the repository being committed in — not from the session's own
# config, for the same reason the gates are pointed at `$target`.
posture=warn
cfgdir=${target:-.}
if [ -r "$cfgdir/project-atlas.config.json" ] && command -v jq >/dev/null 2>&1; then
  case $(jq -r '.branching.sopGate // ""' "$cfgdir/project-atlas.config.json" 2>/dev/null) in
    enforce) posture=enforce ;;
  esac
fi
case "$ATLAS_COMMIT_SOP" in
  enforce) posture=enforce ;;
  warn)    posture=warn ;;
esac

WARN=''
BLOCK=''
BROKE=''

# Two lines of shell instead of an array, because this has to run under `sh`.
add_warn() { WARN="${WARN}$1
"; }
add_block() { BLOCK="${BLOCK}$1
"; }

# A gate that exits with anything other than 0 or 1 did not evaluate anything. Reported as loudly as a
# finding — "a check that did not run is never reported as having passed" — and never as a refusal unless
# someone asked for that. The reasoning is printed once at the end rather than three times here.
broke() {
  BROKE=1
  add_warn "  ${1} could not run (exit ${2}). This commit was NOT checked by it.
${3}"
}

# ------------------------------------------------------------------ 1 · branch discipline (SOP)

out=$("$ATLAS" branch $ROOTARG 2>&1)
st=$?
if [ $st -eq 1 ]; then
  add_warn "  SOP · one logical change, on a branch of its own
${out}
  Why: this project's own first five commits went straight to \`main\` while its contributing guide preached
  discipline, and a rule nobody notices being broken is not a rule. A branch keeps review, revert and two
  people working at once cheap.
  Do:  atlas branch <type> <slug>   — uncommitted work comes across with you."
elif [ $st -ne 0 ]; then
  broke "the branch guard" $st "$out"
fi

# ------------------------------------------------------------------ 2 · documentation rot (blocking)

out=$("$ATLAS" health --gate $ROOTARG 2>&1)
st=$?
if [ $st -eq 1 ]; then
  add_block "$out"
elif [ $st -ne 0 ]; then
  broke "the health gate" $st "$out"
fi

# ------------------------------------------------------------------ 3 · the plan item (SOP)
#
# The plan gate needs the commit message. It is piped rather than passed as an argument so nothing has to be
# quoted back into a shell — a message containing a quote would otherwise rewrite the command running it.
#
# Why the message is missing is something only this script can tell, and the difference matters: the gate used
# to name stdin for every case, which told someone who had written `-F "$DIR/msg.txt"` to use `-F <file>` —
# advice to do the thing they had just done. A guard is trusted, so misdiagnosis costs more than silence.
msg=$(printf '%s' "$cmd" | sed -n 's/.*-m[[:space:]][[:space:]]*"\([^"]*\)".*/\1/p')
[ -z "$msg" ] && msg=$(printf '%s' "$cmd" | sed -n "s/.*-m[[:space:]][[:space:]]*'\([^']*\)'.*/\1/p")

why=absent
if [ -z "$msg" ]; then
  raw=$(printf '%s' "$cmd" | sed -n 's/.*-F[[:space:]][[:space:]]*\([^[:space:]]*\).*/\1/p')
  f=$(printf '%s' "$raw" | sed "s/^[\"']//; s/[\"']$//")     # a quoted path is still quoted at hook time
  if [ "$f" = "-" ]; then
    why=stdin
  elif [ -n "$f" ]; then
    if [ -r "$f" ]; then
      msg=$(cat "$f")
    else
      # Three ways a `-F <path>` fails to open at hook time, and they need three different sentences.
      #
      #   pending      the same command line writes the file — `cat > msg.txt && git commit -F msg.txt`.
      #                The hook runs *before* the shell, so the file cannot exist yet and never will if this
      #                refuses: the write is inside the command being judged. This is the shape that put a
      #                live session in a loop.
      #   unexpanded   a variable or `~` that the shell has not substituted yet, so the path is literal text.
      #   unresolved   a literal path that simply is not there.
      case "$f" in
        *'$'*|'~'*) why=unexpanded ;;
        *)
          if printf '%s' "$cmd" | grep -qF "> $f" || printf '%s' "$cmd" | grep -qF ">$f"; then
            why=pending
          else
            why=unresolved
          fi ;;
      esac
    fi
  fi
fi

out=$(printf '%s' "$msg" | "$ATLAS" spec --gate $ROOTARG --why "$why" 2>&1)
st=$?
if [ $st -eq 1 ]; then
  add_warn "  SOP · a shipped change names the plan item it advances
${out}"
elif [ $st -ne 0 ]; then
  broke "the plan gate" $st "$out"
fi

# ------------------------------------------------------------------ the verdict

[ -z "$BLOCK" ] && [ -z "$WARN" ] && exit 0

FOOT=""
if [ -n "$BROKE" ]; then
  FOOT="  A gate that could not run is a defect in this guard, not in the commit. It says so rather than
  claiming to have passed, and it does not refuse: a tool that blocks somebody's work because its own
  check crashed is a tool that gets switched off, after which nothing is checked at all.
"
fi
if [ "$posture" = enforce ]; then
  FOOT="${FOOT}  Refused because branching.sopGate is \"enforce\" in this repository. The default is to warn and
  proceed: these are claims about how work is organised, not claims that the repository is wrong."
else
  FOOT="${FOOT}  Blocking findings are claims that the repository is wrong — a dead link, a duplicate title, a missing
  H1. The above are process SOPs, which are judgements a person makes, so they say their piece and let the
  commit through. To refuse on them too: \"branching\": { \"sopGate\": \"enforce\" } in project-atlas.config.json."
fi

if [ -n "$BLOCK" ]; then
  printf '%s\n' "$BLOCK" >&2
  [ -n "$WARN" ] && printf 'project-atlas: also, process SOP(s) not met — none of these blocked this commit:\n\n%s\n' "$WARN" >&2
  exit 2
fi

if [ "$posture" = enforce ]; then
  HEAD='project-atlas: process SOP(s) not met. Refused.'
else
  HEAD='project-atlas: process SOP(s) not met. This is a WARNING and the commit proceeds.'
fi
TEXT="${HEAD}

${WARN}
${FOOT}"

if [ "$posture" = enforce ]; then
  printf '%s\n' "$TEXT" >&2
  exit 2
fi

# stderr for the debug log and for any runtime that reads it; stdout JSON is what actually reaches the
# session on exit 0. Unrecognised keys in hook JSON are ignored rather than fatal, so this is safe on a
# runtime that knows only some of them.
printf '%s\n' "$TEXT" >&2
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$TEXT" | jq -Rs '{systemMessage: ., hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: .}}'
else
  esc=$(printf '%s' "$TEXT" | tr '\n\r\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "$esc" "$esc"
fi
exit 0

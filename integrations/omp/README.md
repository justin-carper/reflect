# omp integration

```sh
./install.sh --harness omp
```

Or by hand, which is all the installer does here:

```sh
mkdir -p ~/.omp/agent/commands
cp integrations/omp/commands/reflect.md ~/.omp/agent/commands/
```

Either way you get `/reflect` — omp loads native slash commands from
`~/.omp/agent/commands/*.md`.

## Where your transcripts live

`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl`, one JSON object
per line. Override with `REFLECT_OMP_SESSIONS` if yours are elsewhere.

## What gets filtered out

omp (a pi fork) stores the same JSONL session layout as pi, but marks the
author of every user-role message with `attribution: "user" | "agent"` — a
marker pi lacks. The adapter keeps only `attribution: "user"` text, so the
filter is exact rather than heuristic. Also excluded:

| Source | Meaning |
|---|---|
| nested session directories | subagent sessions persist under their parent session file's basename; their user-role text is `attribution: "agent"`. The adapter only reads top-level session files. |
| `attribution: "agent"` user messages | prompts the agent wrote (subagents, injected context) |
| `custom_message` entries | extension-injected context, incl. skill expansions |
| `toolResult`, `bashExecution`, `assistant` roles | not human input |
| `compaction` entries | summaries, which may embed retained user-role context |

Steering messages (typed mid-stream while the agent runs) are regular human
input and kept.

## Note on repo grouping

Like pi, omp has no project-identity record, so the adapter uses `cwd` as the
repo key. Git worktrees of the same repository therefore count as separate
repos — read the concentration percentage as a floor.

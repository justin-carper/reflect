# pi integration

```sh
./install.sh --harness pi
```

Or by hand, which is all the installer does here:

```sh
mkdir -p ~/.pi/agent/prompts
cp integrations/pi/prompts/reflect.md ~/.pi/agent/prompts/
```

Either way you get `/reflect` — pi loads prompt templates from `~/.pi/agent/prompts/*.md`.

There is no nudge plugin here. pi's extension system could support one, but the value
is low enough that a periodic manual run is the honest recommendation — reflection
yield is front-loaded, so running it more often does not find proportionally more.

## Where your transcripts live

`~/.pi/agent/sessions/--<slugified-cwd>--/<timestamp>_<uuid>.jsonl`, one JSON object
per line. Override with `REFLECT_PI_SESSIONS` if yours are elsewhere.

## What gets filtered out

pi marks machine-generated text by entry type rather than by flags on the user
message — injected text arrives as plain `role: "user"` entries with no extra keys.
The adapter excludes:

| Source | Meaning |
|---|---|
| nested session directories | subagent sessions persist under their parent session file's basename (`<session>/tasks/…`); their "user" text is a prompt the parent agent wrote. The adapter only reads top-level session files. |
| `custom_message` entries | extension-injected context |
| `toolResult`, `bashExecution`, `assistant` roles | not human input |
| `compaction` entries | summaries, which may embed retained user-role context |
| `<skill name="…" location="…">` envelopes | `/skill:name` expansions; the envelope is stripped and the arguments typed after it are kept |

Two things cannot be filtered: prompt-template expansions (`/name`) are stored as
plain user text with no marker, and sessions started by automation (headless
`pi -p`) are indistinguishable from typed ones. Both are rare enough in practice
that the signal gate absorbs them.

## Note on repo grouping

pi has no project-identity record, so the adapter uses `cwd` as the repo key. Git
worktrees of the same repository therefore count as separate repos, which makes the
concentration warning softer than it is for opencode. If you work in worktrees
heavily, read that percentage as a floor.

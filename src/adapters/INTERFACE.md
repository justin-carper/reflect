# Writing an adapter

An adapter converts one harness's on-disk session history into normalized sessions. Everything downstream — signal gating, deduplication, statistics, markdown emission, the analysis prompt — is shared and already written.

Look at [`opencode.mjs`](./opencode.mjs) and [`claude-code.mjs`](./claude-code.mjs). They are ~110 and ~140 lines including comments.

## Contract

```js
export const name = 'my-harness'      // CLI value for --harness
export const label = 'My Harness'     // shown in `reflect doctor`

export function detect() {}           // -> boolean: is this harness's data present?
export function describe() {}         // -> { present, root, ...counts } for doctor output
export function load({ since }) {}    // -> Session[]
```

### Session shape

```js
{
  id: string,          // stable session identifier
  harness: string,     // your adapter's `name`
  project: string,     // working directory of the session
  repo: string,        // canonical repo root — see below
  title: string,
  createdAt: number,   // epoch ms
  messages: [
    { at: number, text: string }   // epoch ms, human-authored text only
  ]
}
```

`load` must:

- return **only top-level sessions** — never subagent/sidechain sessions
- return **only text a human typed** — see below, this is the whole job
- sort `messages` chronologically
- skip sessions whose newest message is at or before `since`
- omit sessions with no human messages
- never throw on malformed files; skip them

Register it in [`index.mjs`](./index.mjs).

## The only hard part

**How does this harness mark text a human did not type?**

Harnesses store a great deal under the "user" role that no human wrote: injected system reminders, skill and rule content, compaction summaries, tool results, slash-command expansions, and prompts written by the agent for its own subagents.

Two real examples of how much:

| Harness | Marker | Share removed |
|---|---|---|
| opencode | `part.synthetic === true` | 27% of user text parts |
| opencode | `session.parentID` present | 55% of all sessions |
| Claude Code | `toolUseResult` present | 59% of user records |
| Claude Code | `isMeta`, `sourceToolUseID`, `isSidechain` | remainder |

Analyze an unfiltered corpus and the top "user phrases" turn out to be your own tooling's boilerplate. It looks like signal and is not.

Prefer a **negative** test — exclude what is marked as machine-generated — over a positive one. Positive markers are unreliable: Claude Code has `promptSource: "typed"`, but it appeared on only 2 of 315 user records, so requiring it would discard almost everything.

Also watch for command-template wrappers. A slash command may expand into a long template with the user's actual input embedded inside it, and may carry no marker at all. opencode's looks like:

```
The user input can be provided directly by the agent or as a command argument … User input:
<what the person actually typed>
```

Strip the wrapper, keep the tail.

## `repo` vs `project`

`project` is the working directory. `repo` groups sessions for the concentration warning, and must collapse git worktrees of one repository into a single key — otherwise a corpus that is 80% one repo reports as several smaller ones and the warning never fires.

Ask the harness rather than guessing from path names. opencode stores a project record whose `worktree` is the canonical root; a name-based heuristic on the same data produced the wrong answer (48% concentration instead of the true 83%). If the harness offers nothing, fall back to `cwd` and document that worktrees will split.

## Verifying it

Add fixtures under `test/fixtures/<your-harness>/` and a case in `test/adapters.test.mjs`. Fixtures must be **synthetic** — never real transcripts, which contain private code and conversation.

Assert at minimum:

- injected/meta records are excluded
- subagent/sidechain sessions are excluded entirely
- tool-result records are excluded
- command wrappers are unwrapped
- `since` filtering works
- malformed lines/files do not throw

Then check against your own real data:

```sh
reflect doctor
reflect build --harness my-harness --all
```

Sanity-test the output: does the message count look like the number of things you actually typed, or like ten times that? If the latter, your filter is missing a marker.

# Why it works the way it does

Six things about your own session history that decided how this tool is built. Most of them probably apply to you, and you don't need to run anything to use them.

Figures are collected at the end, in [The numbers](#the-numbers). They come from building this against one developer's history, so trust their direction more than their size.

## You've written rules. Some of them don't bind.

You have an `AGENTS.md` or a `CLAUDE.md`. Your agent follows parts of it and ignores others, and you already know which — they're the ones you find yourself saying out loud, session after session.

The ignored ones share a shape. Each states an intention but names no command, produces nothing you could check afterwards, and has no moment where anyone looks. Four real examples:

- *Verify before claiming done.* Named no verifier and no moment. It became "I believe it works."
- *Search before authoring.* No trigger, no evidence a search happened. The duplicate function already existed by the time anyone noticed.
- *Don't delete files as part of a fix.* Scoped to fixes. Every violation happened during a merge or a cleanup, which the agent didn't classify as a fix.
- *Check for a `DO NOT EDIT` header before editing a generated file.* That repository's generated files had no such header. The check passed every time while being wrong every time.

Here's the test you can run on your own rules file right now, without this tool. For each rule, answer three questions: **what command proves it?** **what artifact shows it happened?** **at what moment is it checked?** A rule with no answer to all three is a preference you're hoping for, not a rule.

None of the four above needed firmer wording. They needed a gate. Several collapsed into one change — a completion report that has to answer specific questions: which verifier ran and what it printed, what was searched before writing something new, what was deleted, whether production code changed, what each addition traces back to.

This is why the analysis prompt asks *why a rule failed to land* before it asks for new rules, and why ignored-rule findings come first in the report.

It also follows that adding rules to a file that already fails to bind has negative value. Enforcement your harness can't ignore — permission prompts, hooks, pre-commit checks — beats any amount of rule text.

> Ten findings of this kind came out of the first run, against a rules file that had been rewritten hours earlier.

## You won't find them by searching your history

The obvious move is to grep your own sessions for whatever you keep repeating. It doesn't work, and it fails for a reason worth knowing: you never phrase the same preference the same way twice.

One habit in this history showed up in nine separate sessions with no phrase — not even two words — common to all nine. It's the same objection every time, to production code being edited so a test would pass:

- "DO NOT CHANGE PROD CODE"
- "Not a fan of the production code change to allow for testing"
- "this touches prod code"
- "these services should not spin up in prod"

The only shared word is "prod", which also appears in dozens of messages that have nothing to do with this. To catch these four, a word-matching tool has to flag all of those too.

> Counting exact repeats across the whole history surfaced only filler: `continue`, `yes`, `try again`, `commit and push`. Zero durable preferences.

## Some corrections only exist in a pair of messages

Two consecutive messages from one session, paraphrased. The first asked why the agent had built its own mock generator when the repository already had one. The second said that wasn't the pattern, the agent had created those itself, and it should use the generated ones.

Read the first alone and it's a question about one repository. Read the second alone and it's ordinary frustration. In order, they're a durable failure: the agent wrote a second implementation of something that already existed instead of looking first.

Neither message supports that conclusion on its own. Their adjacency does. That's the whole reason this tool hands your sessions to a model instead of computing an answer — a script can score messages, but it can't read a conversation.

## Most of what's filed as "you" isn't you

Open your own session files and go looking for your messages. Under the "user" role you'll find rule and skill text injected at startup, summaries written when a conversation got compacted, tool results, slash-command templates wrapped around your actual sentence, and prompts the agent wrote for sessions it started for itself.

Leave that in and any analysis learns your tooling's vocabulary instead of your preferences. An early unfiltered run confidently reported a framework's own instruction text and a compaction prompt as this developer's most characteristic phrases.

If you ever read your own history — with this tool, a script of your own, or by hand — three traps are worth knowing:

**Exclude what's marked machine-made. Don't require proof a human typed it.** One harness does have a "typed by a human" marker. It appeared on 2 of 315 user records, so trusting it would have discarded almost everything real.

**Watch for wrappers with no marker at all.** A slash command can bury your one real sentence inside a long template and flag nothing. Strip the template, keep the tail.

**Ask the harness which project a session belongs to. Don't guess from the path.** More on why below.

> Injected content was 27% of user text. Sessions the agent started for itself were 55% of all sessions. In a second harness, tool results filed as user records were 59% of them.

## Your history is more lopsided than you think

Whatever you work on most is going to swamp everything else. In this history, one repository accounted for 83% of the sessions worth reading.

That number changes how you read a finding. "This appeared in nine sessions" sounds strong until all nine turn out to be the same repository, at which point you've found that repo's convention — real, but belonging in that repo's rules file rather than your global one. The corpus header reports the concentration for exactly this reason, and the analysis prompt weights findings by how many *distinct* repositories support them.

It's also the trap that nearly went unnoticed. Grouping sessions by directory name, to merge git worktrees of the same project, reported the largest repository at 48% when the truth was 83% — the heuristic quietly suppressed the warning it existed to raise. One harness stores canonical project identity. Asking it was simpler and correct.

## Repeats make thin evidence look thick

Two things inflate a finding, and both were caught by noticing a suspicious number rather than by design.

**Your client resends messages.** One corpus held 82 verbatim repeats inside sessions that qualified, a few of them sent up to nine times. Left in, a passing remark looks emphatic.

**Resumed and forked sessions duplicate whole conversations.** Near-identical transcripts make one conversation count as two, and its findings look independently corroborated.

Both are removed before analysis. That's what makes "this appeared in N sessions" mean anything at all.

## Why it doesn't run in the background

You'd expect a tool like this to watch continuously and accumulate. It doesn't, for three reasons.

1. **You get almost everything on the first run.** Six months of history produced about a dozen rules. The tenth example of a pattern changes no decision the third didn't already.
2. **A lopsided history misleads a loop worse than it misleads you.** Run per session and you keep rediscovering your busiest repo's conventions, mistaking repetition for confirmation.
3. **If your rules are already being ignored, more rules is the wrong output.** The bottleneck is enforcement, and no loop fixes that.

An occasional manual pass gets nearly all the value. The optional nudge exists only because a command you have to remember to run is a command you won't run.

## What the tool refuses to do

Four constraints, each preventing a specific failure:

**It never calls a model.** It builds a corpus and prints a prompt; your agent reasons. No API keys, no provider coupling, and the analysis runs on a model you already trust.

**Harness-specific code lives only in adapters.** Storage layout is the one thing that differs. Gating, deduplication, statistics, and the prompt are shared. Adapters read undocumented on-disk formats, so they fail loudly rather than quietly handing you an empty corpus.

**The correction patterns gate, they never extract.** They choose which sessions deserve a model's attention and have no say in what the findings are. The counting failure above is why.

**Nothing is applied for you.** The analyzer writes a report and has no write access to rules, code, or config. Most of any corpus is noise and findings are phrased as behavioral rules, so an automatic path would quietly accumulate wrong ones.

## What this doesn't tell you

- **One sample.** Every figure here comes from one developer's history. The direction is more trustworthy than the magnitude.
- **Anything you didn't push back on is invisible.** A correction only exists in your history if you noticed and said something. Whatever your agent got wrong unchallenged leaves no trace, so any error rate you compute from this is a floor.
- **Two harnesses.** A third needs about 80 lines. The only hard part is identifying that harness's machine-generated markers.
- **Repo grouping varies.** Where a harness exposes no project identity, the working directory is used and git worktrees split into separate repositories, which makes the concentration warning softer than it should be.
- **The model doing the analysis matters.** A weak one produces plausible findings on weak evidence. The prompt demands verbatim quotes and session IDs so you can check its work.
- **English only.** The correction patterns are English regexes.

## The numbers

One developer, about six months, 711 stored sessions across 16 working directories. One sample.

| Measurement | Value |
|---|---|
| Top-level sessions considered | 309 |
| Your own messages, after filtering | ~3,000 |
| Sessions with enough correction to be worth reading | 66 (~62k tokens) |
| Share of that corpus specific to one task, transferring nothing | ~90% |
| Largest single repository's share | 83% |
| Findings worth acting on, first run | 10 |
| Sessions supporting the strongest findings | 7–16 |
| **Searching for repeated phrases** | |
| Recurring exact phrases found | 116, all filler |
| Most frequent (`continue` / `yes` / `try again`) | 57 / 39 / 7 sessions |
| Durable preferences found this way | 0 |
| Instruction sentences, and how many were distinct | 420, of which 342 |
| Repeated instructions in a second harness's history | 2, one a script's warm-up string |
| **Filtering** | |
| Injected content, as a share of user text | 27% |
| Sessions that were the agent's own subagents | 55% |
| Tool results filed as user records (second harness) | 59% |
| Records carrying a "human typed this" marker | 2 of 315 |
| Concentration by path heuristic vs. the truth | 48% vs. 83% |
| **Duplicates** | |
| Verbatim repeat messages in one corpus | 82, some sent 2–9 times |

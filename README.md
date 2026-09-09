# reflect

Find the sessions where you corrected your coding agent, and turn them into rules that actually bind.

## What this is

Your coding agent stores every session on your disk. Months of you telling it what it did wrong are sitting there in files you've never opened.

`reflect` reads that history, keeps only the sessions where you pushed back, writes them to a single file, and prints a prompt for analyzing it. Your agent does the analyzing and hands you a report.

Two terms used throughout:

- **Harness** — the program that runs the model. Claude Code, opencode, pi, and omp are harnesses. All four are supported.
- **Corpus** — the single file `reflect` builds. Just the messages you typed, from the sessions worth reading, in order.

**It never calls a model.** No API keys, no provider setup, nothing to pay for. The analysis runs on whatever model you already use.

## Do you need it yet?

It needs history to find patterns in. If you started using an agent last week, there's nothing here for you yet — come back in a couple of months.

`node src/cli.mjs count` answers this in one number: how many of your sessions currently qualify. If that's a handful, wait. For scale, the history this tool was built against had 66 qualifying sessions from about six months of daily use.

## What you get

A report, written to a file. Here is one finding from it — fabricated for illustration, but in the real format:

```markdown
## A2 — "Run the linter before saying you're done" (AGENTS.md §5)

**Rule as written:** "Don't report work complete based on your reading of the
code. Run the repo's linter, fix what it reports, and re-run until it passes."

**Evidence — 3 sessions, 2 repos:**

- `ses_a1b2c3` [15] "did you even run the linter"
- `ses_d4e5f6` [7] "run make lint and fix the errors"
- `ses_g7h8i9` [22] "check again, i don't think you fixed anything"

**Why it didn't bind:** the rule never names a linter. These repos use three
different commands, and the rule's escape hatch — ask which one — was never
taken; the agent neither ran a linter nor asked. The fix is a gate, not firmer
wording: name the command in each repo's rules file, and require the completion
report to quote its output.
```

That shape — a rule you already wrote, ignored, plus the reason it didn't stick — is the most useful thing the tool produces. The rest of the report covers new rules, conventions specific to one repo, weak signals not worth acting on yet, and a verdict on whether running it again soon is worthwhile.

## Run it

Needs Node 18 or newer. No dependencies to install. Reading opencode history additionally needs Node 22.5 or newer, because opencode keeps its sessions in SQLite and the reader uses the built-in `node:sqlite`; `reflect doctor` says so if your runtime is older. Claude Code history has no such requirement.

**1. Get it and install it.**

```sh
git clone https://github.com/justin-carper/reflect.git
cd reflect
./install.sh
```

The installer symlinks `reflect` into `~/.local/bin` and copies the `/reflect` command into whichever harnesses it finds. It tells you if `~/.local/bin` isn't on your `PATH`, and it doesn't edit your shell profile for you.

Re-running it is safe. Files that already match are left alone, and anything you've edited yourself is reported and skipped rather than overwritten. `./install.sh --help` lists the options; `--dry-run` shows what it would do.

Skipping the installer is fine too — every command below works as `node src/cli.mjs <command>` from the clone.

**2. Check what it can see.**

```sh
reflect doctor
```

Prints your state directory, one line per harness — `found` or `absent`, with the path it looked in — and the watermark from your last run, which is unset the first time and explained in step 5. Nothing is analyzed yet.

**3. Build the corpus.**

```sh
reflect build
```

Prints where it wrote the corpus, how many sessions qualified out of how many it considered, the message count, the size in tokens, what it discarded as duplicated, and how many repos are represented. If one repo dominates, you get a warning — pay attention to it, because a habit that only shows up in one repo is that repo's convention rather than a preference of yours. [Why that matters](./docs/why-it-works.md#your-history-is-more-lopsided-than-you-think).

**4. Hand the prompt to your agent.**

```sh
reflect prompt
```

Paste the output into your agent. It reads the corpus, reads your existing rules files, and writes the report. If the installer set up your harness, `/reflect` does all of this for you — see [`integrations/`](./integrations).

**5. Once you've acted on the findings, set the watermark.**

```sh
reflect mark-reflected
```

The **watermark** is a timestamp saved in your state directory. After it's set, `build` only looks at sessions newer than it, so the next run won't re-analyze what you already dealt with. Pass `--all` when you want full history anyway.

## Updating

```sh
cd reflect
./install.sh --update
```

That pulls the repo and re-syncs the harness files in one step. The CLI is a symlink into your clone, so it's current the moment the pull finishes.

The installer remembers what it wrote. A harness file it installed and you never touched gets updated silently; one you edited is skipped and reported, so an update can't quietly revert your changes. `--force` overrides that if you want the repo's version back.

## What to do with a report

Nothing gets applied for you. The analyzer has no write access to your rules, your code, or your config — it writes a report and stops. That's a deliberate choice: most of any corpus is noise, and findings are phrased as behavioral rules, so an automatic path would quietly accumulate wrong ones.

Work through it in this order:

1. **Enforcement gaps.** Rules you already wrote that got ignored. Fix the gate — a named command, a required artifact, a moment where it's checked — rather than the wording. Cheapest wins in the report.
2. **New rules.** Check how many distinct repos support each one. A pattern from a single repo isn't a general preference.
3. **Repo conventions.** These belong in that repo's rules file, not your global one.

## Why it works

- **Counting what you repeat finds nothing.** People never phrase a preference the same way twice. Looking for exact repeats across roughly 3,000 real messages surfaced only filler — `continue`, `yes`, `try again`.
- **Most of the text is noise.** About 90% is specific to the task at hand and transfers nowhere. Filtering it out is most of the work.
- **The best finding is usually a rule you already wrote.** The first real run produced ten cases where an existing rule had been restated by the user, meaning the rule existed and failed to bind. That's worth more than a new rule, because the fix is a gate rather than more words.
- **The yield arrives early.** Six months of history produced about a dozen rules. The tenth example of a pattern changes no decision the third didn't already. Run this occasionally, not continuously — there is deliberately no background loop.

Evidence for all four, plus a test you can run on your own rules file: [`docs/why-it-works.md`](./docs/why-it-works.md).

## What counts as signal

Most of what a harness files under the "user" role was never typed by you: rule and skill text injected at startup, summaries written when a conversation is compacted, tool results, slash-command templates wrapped around your actual words, and prompts the agent wrote for sessions it started for itself. Leave those in and the analysis learns your tooling's vocabulary instead of your preferences.

`reflect` drops all of it, plus messages your client sent twice and forked sessions that are near-copies of each other. What's left is what you typed.

A session then qualifies if it contains at least two corrective messages, recognized by patterns in [`src/lexicon.mjs`](./src/lexicon.mjs). Those patterns are a **gate, not an extractor** — they decide which sessions deserve a model's attention, and never decide what the findings are.

## Harness support

| Harness | Status |
|---|---|
| opencode | native adapter |
| Claude Code | native adapter |
| pi | native adapter |
| omp | native adapter |
| anything else | works via a ~80-line adapter, or a hand-assembled corpus |

Adding one: [`src/adapters/INTERFACE.md`](./src/adapters/INTERFACE.md).

## Privacy

> [!IMPORTANT]
> The corpus is verbatim text you typed, including anything you pasted. On a work machine that means proprietary code, internal hostnames, ticket numbers, and colleagues' names.

- Everything stays local. Nothing is uploaded; the tool makes no network calls.
- Output goes to your state directory, outside any repo, so it can't be committed by accident.
- Reports quote sessions verbatim. If you keep them somewhere versioned, gitignore them.
- The corpus is sent to whatever model your agent uses when you paste the prompt. That is the one point where data leaves your machine, and it's under your control — check your provider's retention terms if that matters to you.

## Reference

```
reflect doctor              which harnesses are detected, and your watermark
reflect build [options]     write the corpus, print stats
reflect count [options]     qualifying session count only
reflect prompt [options]    print the analysis prompt
reflect mark-reflected      stamp the watermark at now
```

```
./install.sh                install for every detected harness
./install.sh --update       git pull, then re-sync the harness files
./install.sh --force        overwrite harness files you have modified
./install.sh --with-nudge   also install the optional opencode nudge plugin
./install.sh --dry-run      print every action, change nothing
./install.sh --harness N    limit to opencode, claude-code, pi, or omp
./install.sh --uninstall    remove the symlink and any unmodified file
```

| Option | Meaning |
|---|---|
| `--harness NAME` | `opencode`, `claude-code`, `pi`, or `omp`; default is every detected harness |
| `--all` | ignore the watermark, use full history |
| `--min-signal N` | corrective messages required per session (default 2) |
| `--out PATH` | corpus destination (default `<state-dir>/corpus.md`) |
| `--state-dir PATH` | state and default output location |
| `--max-chars N` | per-message truncation (default 700) |
| `--with-path PATH` | corpus path to embed in the printed prompt |
| `--reports-dir PATH` | where the analyzer should write its report |

| Environment | Purpose |
|---|---|
| `REFLECT_STATE_DIR` | state directory |
| `REFLECT_OPENCODE_DB` | opencode session database (`opencode.db`) |
| `REFLECT_CLAUDE_PROJECTS` | Claude Code projects root |
| `REFLECT_PI_SESSIONS` | pi sessions root (`~/.pi/agent/sessions`) |
| `REFLECT_OMP_SESSIONS` | omp sessions root (`~/.omp/agent/sessions`) |

The state directory defaults to `$XDG_STATE_HOME/reflect`, or `~/.local/state/reflect` if that isn't set, or `%LOCALAPPDATA%\reflect` on Windows.

## Tests

```sh
npm test
```

Fixtures are synthetic and generated at test time. No real transcript data is in this repo.

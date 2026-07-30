# Any other harness

The tool never calls a model, so it works with any agent that can read a file. There is nothing to install beyond the CLI.

## If your harness is already supported

```sh
reflect doctor          # confirm it's detected
reflect build           # write the corpus
reflect prompt --with-path ~/.local/state/reflect/corpus.md
```

Paste that prompt into your agent. Ask it to read the corpus and follow the instructions. When you've finished triaging:

```sh
reflect mark-reflected
```

## If your harness is not supported yet

`reflect doctor` will report nothing found. You need an adapter — roughly 80 lines. See [`src/adapters/INTERFACE.md`](../../src/adapters/INTERFACE.md).

The work is almost entirely in one question: **how does this harness mark text that a human did not type?** Everything else is boilerplate.

That question has a different answer in every harness, and getting it wrong is the difference between a useful corpus and one full of the harness talking to itself. In one real corpus, 27% of apparent user messages were injected content and 55% of sessions were subagent sessions whose "user" messages the agent had written. Analyze that unfiltered and you learn your own tooling's vocabulary, not your preferences.

## Manual fallback

If you only want to try the idea before writing an adapter, you can assemble a corpus by hand. Collect your own messages from recent sessions where you corrected the agent, strip anything you did not type, and format it as:

```markdown
## Session <id>

- Date: 2026-01-15
- Project: /path/to/repo
- Title: whatever

[1] first thing you typed

[2] second thing you typed

---
```

Then run `reflect prompt --with-path <your-file>` and hand the output to your agent. The prompt does not care how the corpus was produced.

Aim for sessions where you pushed back at least twice. Sessions with no corrections contain no signal, and including them costs tokens for nothing.

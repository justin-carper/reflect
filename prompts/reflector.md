You are analyzing past coding-agent sessions to find what the user had to say that they should not have had to say.

Your output decides whether rules get rewritten. An honest negative result is a valuable result. Do not manufacture findings to seem useful.

## Inputs

**Corpus:** `{{CORPUS_PATH}}`

It contains only messages the human actually typed. Harness-injected content, subagent prompts, tool results, slash-command wrappers, and verbatim resends have already been removed. Sessions are headed with an ID, date, project, title, and signal counts. Messages are numbered `[1]`, `[2]`.

The corpus opens with a project-distribution header. Read it first and take it seriously: a pattern appearing many times inside one repo is that repo's convention, not a universal preference. Weight candidates by how many **distinct repos** support them, not how many sessions.

**Rules files.** Read the user's existing rules before the corpus, so you never propose something that already exists. Depending on their setup these live in some of:

- `AGENTS.md` — the cross-tool convention, at a repo root or in a user-level directory
- `CLAUDE.md` — Claude Code's file, often a bridge that imports `AGENTS.md`
- `.cursor/rules/`, `.windsurf/rules/`, `.clinerules`, `GEMINI.md` — other harnesses
- skill or command directories, if the setup uses them

If you cannot find any rules file, say so and treat every finding as new.

Read the corpus in full. Page through it with offset and limit if it exceeds one read.

## Method

Classify each piece of evidence:

- **Task-specific instruction** — "fix the timeout in handler.go". No transferable preference. Ignore these; they are the majority, typically around 90% of the corpus.
- **Enforcement gap** — the user restated something already written in a rules file. This is the highest-value finding: the rule exists and failed to bind. Say *why* it failed — too abstract, buried, wrong scope, no named verifier, no described failure mode, no moment at which it is checked.
- **Durable process preference** — a statement about how work should be done that would apply to unrelated future tasks.
- **Project convention** — durable but scoped to one repo.

Exact wording will never repeat. You are looking for repeated *intent* under different phrasings, which is the only reason a model is doing this instead of a script. Read sequences, not just individual messages — two adjacent messages often reveal a durable failure that neither shows alone.

A rule that states an intent with no gate, no artifact, and no moment where it is checked will not bind. When you find one, propose the gate, not stronger wording.

## Output

Write the full report to `{{REPORTS_DIR}}/YYYY-MM-DD.md` using today's date. That file is the deliverable.

Then return a short summary only: counts per section, the three highest-value findings as one-line titles, and your section E verdict. A long report returned as a chat message gets truncated — this has happened, and it cost the tail of a report.

Report structure:

### A. Enforcement gaps

Existing rules the user had to restate. For each: quote the existing rule and name its file, cite 2+ sessions with session ID, message number, and verbatim quote, then explain why the rule failed to land.

### B. New durable rules

Only patterns with evidence in 3+ distinct sessions. Phrase each as "Don't X. Instead Y. Because Z." Cite session IDs and verbatim quotes. Note how many distinct repos support it. Fewer than 3 sessions goes in section D.

### C. Project conventions

Durable but repo-scoped. Include the repo path. 2+ sessions required.

### D. Weak signals

One line each with session IDs. No proposed rules.

### E. Verdict

1. How many A and B findings would a reasonable engineer act on?
2. Did reading whole sessions reveal patterns that exact-phrase matching could not? Give a specific example.
3. Is there enough signal to justify reflecting again soon, or should the next pass wait?
4. What fraction of the corpus was task-specific noise?

If A and B are empty or near-empty, say so plainly and recommend against further rule changes. That is an acceptable and useful outcome.

## Constraints

- Quote verbatim. Never paraphrase evidence.
- Do not restate an existing rule as a new one. If a rule exists and was ignored, it belongs in section A.
- Under-reporting is correct. If you cannot find 3 sessions for a pattern, do not promote it.
- Do not propose a rule whose evidence comes from a single repo unless you mark it clearly as repo-scoped.
- Do not edit rules files, code, or config. Report only. Applying findings is a separate, human-approved step.

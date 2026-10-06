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

Also read, when they exist:

- **Pattern-triggered rules** — omp TTSR rules in `~/.agents/rules/`, `~/.omp/agent/rules/`, and project `.omp/rules/`. A file with a `condition:` (regex) frontmatter key is one. Note their names and triggers so section F never duplicates one.
- **Installed skills** — the `name` and `description` frontmatter of each `~/.agents/skills/*/SKILL.md`, so section G proposes an update to an existing skill instead of a near-duplicate.
- **Prior reports** in `{{REPORTS_DIR}}` — their `## Triage outcome` sections list findings the user already rejected. Never re-propose a rejected finding unless new evidence postdates the rejection; say so if you do.

Read the corpus in full. Page through it with offset and limit if it exceeds one read.

## Method

Classify each piece of evidence:

- **Task-specific instruction** — "fix the timeout in handler.go". No transferable preference. Ignore these; they are the majority, typically around 90% of the corpus.
- **Enforcement gap** — the user restated something already written in a rules file. This is the highest-value finding: the rule exists and failed to bind. Say *why* it failed — too abstract, buried, wrong scope, no named verifier, no described failure mode, no moment at which it is checked.
- **Durable process preference** — a statement about how work should be done that would apply to unrelated future tasks.
- **Project convention** — durable but scoped to one repo.
- **Mechanical restatement** — a correction naming a concrete, pattern-matchable action: a command, a flag, a file path, a literal string ("don't run `git push --force`", "stop editing `*.gen.ts`"). A pattern match can catch it at the moment it happens, so it routes to section F. A correction that needs judgment to apply ("keep it simpler") routes to A or B as before.
- **Repeated procedure** — the user walks the agent through the same multi-step procedure in different sessions, or refers to one by name ("do the sync thing", "like last time", "same steps as before"). A procedure the user has to re-explain is a skill that does not exist yet; it routes to section G.

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

### F. Pattern-triggered rule candidates

Mechanical restatements with evidence in 3+ distinct sessions. At most 3 per report; keep the strongest. For each: session IDs, message numbers, verbatim quotes, distinct-repo count, and a paste-ready draft.

If the setup has omp TTSR rules, draft a complete rule file:

```markdown
---
condition: '<regex matching the action at the moment it happens>'
scope: <tool:bash | tool:edit(<glob>) | text>
agents: [<main, implementer, ...>]
interruptMode: never
---
Don't X. Instead Y. Because Z.
```

Give the filename (`<name>.md`), two sample strings (one the regex must match, one it must not), and how to test them: the source (`tool` or `text`), the tool name for tool scopes, and a file path matching the glob for `tool:edit(...)`/`tool:write(...)` scopes. If the setup has no TTSR rules, propose the equivalent hook or check (pre-commit hook, linter rule, harness hook) instead of omp frontmatter.

### G. Skill candidates

Repeated procedures with evidence in 2+ distinct sessions. At most 2 per report. For each: session IDs, message numbers, verbatim quotes, distinct-repo count, then:

- **Create or update** — name the installed skill it overlaps with, if any. Prefer updating it.
- **name** — lowercase, hyphenated.
- **description** — one line saying when to use it, written in the words the user used to ask.
- **Body outline** — the steps as the user explained them, and the completion check that proves the procedure ran.

### E. Verdict

1. How many A and B findings would a reasonable engineer act on?
2. How many F and G candidates would a reasonable engineer adopt?
3. Did reading whole sessions reveal patterns that exact-phrase matching could not? Give a specific example.
4. Is there enough signal to justify reflecting again soon, or should the next pass wait?
5. What fraction of the corpus was task-specific noise?

If A, B, F, and G are empty or near-empty, say so plainly and recommend against further changes. That is an acceptable and useful outcome.

## Constraints

- Quote verbatim. Never paraphrase evidence.
- Do not restate an existing rule as a new one. If a rule exists and was ignored, it belongs in section A.
- Under-reporting is correct. If you cannot find 3 sessions for a pattern (2 for a skill candidate), do not promote it.
- Do not propose a rule whose evidence comes from a single repo unless you mark it clearly as repo-scoped.
- Never copy a secret-shaped string (token, key, password, `KEY=value` credential) into a quote or draft. Write `<redacted>` in its place.
- Do not edit rules files, skills, code, or config. Report only. Applying findings is a separate, human-approved step.

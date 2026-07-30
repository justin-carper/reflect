---
description: Analyze recent sessions for ignored rules and durable preferences, then triage the findings
---

Run a reflection pass over recent session history. Arguments (optional): $ARGUMENTS

Pass `--all` to ignore the incremental watermark and analyze full history. Pass `--min-signal N` to change how many corrective messages a session needs to qualify.

## Steps

1. Build the corpus:

   ```
   reflect build --harness opencode $ARGUMENTS
   ```

   If `reflect` is not on your PATH, use `node "$REFLECT_HOME/src/cli.mjs"` instead.

   Report its stats output verbatim — session count, message count, size, dropped duplicates, repo concentration.

2. If it reports zero qualifying sessions, stop. Tell the user there is nothing to reflect on. That is a valid outcome, not a failure.

3. If it warns about repo concentration, repeat that warning before continuing. The findings will skew toward that repo's conventions.

4. Get the analysis prompt, with the corpus path filled in:

   ```
   reflect prompt --with-path <corpus path from step 1>
   ```

5. Dispatch the `reflector` subagent using that prompt as its instructions. Give it nothing else — it must work from the corpus and the user's rules files, not from your session context.

6. The reflector writes its own report and returns a summary. Read the report file for triage.

7. Triage with the user. Present findings **one at a time**, section A first, since an ignored rule is worth more than a new one. For each: show the evidence, the proposed change, and ask accept / reject / modify. Do not batch them into a single list.

8. Apply only what the user accepts. Universal rules go to their canonical rules file, project conventions to that repo's `AGENTS.md`, and anything that is a multi-step procedure to a skill rather than a rule.

9. Once the user is done triaging, stamp the watermark so the next pass only sees new sessions:

   ```
   reflect mark-reflected
   ```

## Constraints

- Do not apply any finding without explicit approval.
- Do not commit anything. Name the command and stop.
- If the user rejects a finding, note it in the report file so the next pass does not re-propose it.

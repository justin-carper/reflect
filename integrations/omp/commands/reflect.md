---
description: Analyze recent omp sessions for ignored rules and durable preferences
argument-hint: "[--all]"
---

Run a reflection pass over recent session history. Arguments (optional): $ARGUMENTS

Pass `--all` for full history instead of only sessions since the last pass.

## Steps

1. Build the corpus:

   ```
   reflect build --harness omp $ARGUMENTS
   ```

   If `reflect` is not on your PATH, use `node "$REFLECT_HOME/src/cli.mjs"` instead.

   Report its stats output verbatim.

2. If it reports zero qualifying sessions, stop and say so. That is a valid outcome.

3. If it warns about repo concentration, repeat that warning.

4. Fetch the analysis prompt with the corpus path filled in:

   ```
   reflect prompt --with-path <corpus path from step 1>
   ```

5. Follow that prompt. If your setup has a subagent tool, dispatch the analysis as a
   subagent so it runs in a fresh context and cannot see this conversation — the
   analyzer should judge the transcripts, not your current session. If not, analyze
   in this session.

6. Read the report the analysis wrote, then triage with me **one finding at a time**,
   section A first. An ignored rule is worth more than a new one. For each: evidence,
   proposed change, then accept / reject / modify.

7. Apply only what I accept. Universal rules go in the canonical rules file — if a
   harness file imports `AGENTS.md`, edit `AGENTS.md`, not the bridge. Project
   conventions go in that repo's `AGENTS.md`.

8. When triage is done, stamp the watermark:

   ```
   reflect mark-reflected
   ```

## Constraints

- Apply nothing without explicit approval.
- Do not commit. Name the command and stop.
- Record rejected findings in the report so the next pass does not re-propose them.

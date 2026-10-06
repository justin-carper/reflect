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

6. Read the report the analysis wrote, then triage with me **one finding at a time**:
   A, then F, then G, then B, C, D. An ignored rule is worth more than a new one, and
   a rule that fires at the right moment is worth more than prose. For each: evidence,
   proposed change, then accept / reject / modify.

7. Apply only what I accept:
   - **A–C:** universal rules go in the canonical rules file — if a harness file
     imports `AGENTS.md`, edit `AGENTS.md`, not the bridge. Project conventions go in
     that repo's `AGENTS.md`.
   - **F:** write the draft to `~/.agents/rules/<name>.md`, then prove the trigger with
     `omp ttsr test --rule ~/.agents/rules/<name>.md --source <tool|text> [--tool <tool>] [--path <file>] '<must-match sample>'`
     using the source, tool, and path the finding gives, and the same command with the
     must-not-match sample. Show both results.
   - **G:** author the skill with the `writing-skills` skill into
     `~/.agents/skills/<name>/SKILL.md`, or update the existing skill the finding names.

8. Review live-captured skills. List `~/.omp/agent/managed-skills/*/SKILL.md` changed
   since `lastReflectedAt` in `~/.local/state/reflect/state.json` (epoch ms). For each,
   show its description and body, then ask: promote / keep / delete.
   - **promote:** move the directory to `~/.agents/skills/<name>/`. If that name
     already exists there, stop and ask — never overwrite an authored skill.
   - **delete:** remove the managed directory.

9. When triage is done, stamp the watermark:

   ```
   reflect mark-reflected
   ```

## Constraints

- Apply nothing without explicit approval.
- Do not commit. Name the command and stop.
- Record rejected findings in the report under `## Triage outcome` so the next pass does not re-propose them.

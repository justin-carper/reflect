// pi adapter.
//
// Storage: ~/.pi/agent/sessions/--<slugified-cwd>--/<timestamp>_<uuid>.jsonl
// One JSON object per line. The first line is a header:
//   { type: "session", version, id, timestamp, cwd, parentSession? }
// then entries { type, id, parentId, timestamp, ... }. Relevant types:
//   message        carries an AgentMessage under `message`; roles are user,
//                  assistant, toolResult, bashExecution
//   session_info   user-set display name under `name`
// Everything else — model_change, thinking_level_change, custom, compaction,
// branch_summary, label, custom_message — is ignored.
//
// Subagent sessions persist nested under their parent session file's basename —
// <slug>/<parent-basename>/tasks/*.jsonl, and in older layouts
// <slug>/<parent-basename>/<hash>/run-N/*.jsonl — so the non-recursive walk
// below never sees them. Their "user" messages are prompts the parent agent
// wrote for its own subagents.
//
// pi carries no marker for whether a human typed a user message: injected text
// arrives as plain role:user entries with no extra keys (checked across a real
// corpus of 992 user messages). What is excluded, and how:
//   custom_message entries   extension-injected context; a different entry type
//   toolResult, bashExecution, assistant   not human input
//   compaction entries       may embed retained user-role context; never read
//   skill expansions         /skill:name is stored as a
//                            <skill name="..." location="...">...</skill>
//                            envelope with the typed arguments, if any, after
//                            it. Strip the envelope, keep the tail — the same
//                            shape pi's own parseSkillBlock parses.
// Prompt-template expansions (/name) are stored as plain user text with no
// marker at all, so there is nothing to strip; they enter the corpus as typed.
// Sessions started by automation (headless `pi -p`) are likewise
// indistinguishable from typed ones — the same limitation the Claude Code
// adapter has with `claude -p`.
//
// pi stores no project-identity record, so `cwd` is the repo key. Worktrees of
// one repo count separately here; the concentration stat is a floor, as with
// Claude Code.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'pi'
export const label = 'pi'

const ROOT = () =>
  process.env.REFLECT_PI_SESSIONS || path.join(os.homedir(), '.pi/agent/sessions')

// The skill-command envelope, mirroring pi's own parseSkillBlock: the block,
// then optionally the arguments the person actually typed after a blank line.
const SKILL_ENVELOPE =
  /^<skill name="[^"]+" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/

// Only .jsonl files directly inside a project directory count. Anything nested
// deeper belongs to a session's subagents or artifacts.
const sessionFiles = () => {
  const r = ROOT()
  const out = []
  let dirs
  try {
    dirs = fs.readdirSync(r, { withFileTypes: true })
  } catch {
    return out
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    let entries
    try {
      entries = fs.readdirSync(path.join(r, d.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(r, d.name, e.name))
    }
  }
  return out
}

export function detect() {
  return sessionFiles().length > 0
}

export function describe() {
  const root = ROOT()
  const files = sessionFiles()
  if (!files.length) return { present: false, root }
  let last = 0
  for (const f of files) {
    try {
      last = Math.max(last, fs.statSync(f).mtimeMs)
    } catch {
      // unreadable file: leave its activity out rather than fail the report
    }
  }
  return {
    present: true,
    root,
    sessions: files.length,
    lastActivity: last ? new Date(last).toISOString() : 'unknown',
  }
}

// Content is an array of blocks where only `type: "text"` counts; images and
// anything else are dropped. A bare string is accepted too — older writers and
// the SDK types allow both shapes.
const textOf = (message) => {
  const c = message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

export function load({ since = 0 } = {}) {
  const out = []
  for (const file of sessionFiles()) {
    let lines
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n')
    } catch {
      continue
    }

    const messages = []
    let sessionId = path.basename(file, '.jsonl')
    let cwd = null
    let title = null
    let startedAt = 0

    for (const line of lines) {
      if (!line.trim()) continue
      let rec
      try {
        rec = JSON.parse(line)
      } catch {
        continue
      }
      // JSON.parse accepts bare `null`, `42`, `"str"` — only objects are entries.
      if (!rec || typeof rec !== 'object') continue
      if (rec.type === 'session') {
        if (rec.id) sessionId = rec.id
        if (rec.cwd) cwd = rec.cwd
        const t = rec.timestamp ? Date.parse(rec.timestamp) : NaN
        if (Number.isFinite(t)) startedAt = t
      } else if (rec.type === 'session_info') {
        // Later renames win: the name shown in /resume is the latest one.
        if (typeof rec.name === 'string' && rec.name.trim()) title = rec.name.trim()
      } else if (rec.type === 'message' && rec.message?.role === 'user') {
        let text = textOf(rec.message)
        const skill = text.match(SKILL_ENVELOPE)
        if (skill) text = skill[1] ?? ''
        text = text.trim()
        if (text.length < 2) continue
        const mt = rec.message.timestamp
        const at = Number.isFinite(mt) ? mt : Date.parse(rec.timestamp ?? '') || 0
        messages.push({ at: Number.isFinite(at) ? at : 0, text })
      }
    }

    if (!messages.length) continue
    messages.sort((a, b) => a.at - b.at)

    // A session can hold a post-watermark message whose text is entirely
    // filtered out, so re-check against surviving messages.
    const latest = messages[messages.length - 1].at
    if (latest <= since) continue

    const dir = cwd ?? '(unknown)'
    out.push({
      id: sessionId,
      harness: name,
      project: dir,
      repo: dir,
      title: title ?? '(untitled)',
      createdAt: startedAt || messages[0].at || latest,
      messages,
    })
  }
  return out
}

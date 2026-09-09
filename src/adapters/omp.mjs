// omp adapter.
//
// Storage: ~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl — the
// same JSONL layout as pi (omp is a pi fork), with these omp additions:
//
//   attribution    user messages carry attribution: "user" | "agent". Text the
//                  person typed is attribution "user"; agent-attributed user
//                  messages are prompts the agent wrote for its own subagents.
//   title          first line is a fixed-width title slot; the header and
//                  title_change entries also carry titles
//   parentSession  lineage marker on forked/branched headers (opaque string)
//
// Subagent sessions persist nested under the parent session file's basename —
// <bucket>/<parent-basename>/<name>.jsonl — so the non-recursive walk below
// never sees them, and their agent-attributed prompts stay out either way.
//
// What is excluded:
//   attribution != "user"     agent-authored prompts, injected context. omp
//                             is a pi fork but writes this marker pi lacks, so
//                             the filter is exact rather than heuristic.
//   custom_message entries    extension-injected context
//   toolResult, bashExecution, assistant roles    not human input
//   compaction entries        may embed retained user-role context; never read
//   skill expansions          stored as custom_message customType
//                             "skill-prompt" (excluded above), not inline as
//                             pi stores them — verified: no <skill envelope
//                             appears in omp user-attributed text
//   title/title_change        metadata, not conversation
// Steering messages (steering: true, typed mid-stream to interrupt) are
// regular typed user input and kept.
//
// omp stores no project-identity record, so `cwd` is the repo key. Worktrees
// of one repo count separately; the concentration stat is a floor, as with
// pi and Claude Code.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'omp'
export const label = 'omp'

const ROOT = () =>
  process.env.REFLECT_OMP_SESSIONS || path.join(os.homedir(), '.omp/agent/sessions')

// Only .jsonl files directly inside a bucket directory count. Anything nested
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
// anything else are dropped. A bare string is accepted too.
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
        if (rec.titleSource === 'user' && typeof rec.title === 'string' && rec.title.trim()) {
          title = rec.title.trim()
        }
      } else if (rec.type === 'title_change') {
        // Auto titles rename freely; a user-set title is deliberate, so the
        // latest one wins over the header/`title` slot value.
        if (rec.source === 'user' && typeof rec.title === 'string' && rec.title.trim()) {
          title = rec.title.trim()
        }
      } else if (rec.type === 'message' && rec.message?.role === 'user') {
        // The whole job: omp marks who authored each user-role message.
        if (rec.message.attribution !== 'user') continue
        const text = textOf(rec.message).trim()
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

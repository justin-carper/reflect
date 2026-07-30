// opencode adapter.
//
// Storage layout (opencode 1.18.x), under ~/.local/share/opencode/storage/:
//   session/**/<id>.json      { id, parentID?, directory, projectID, title, time }
//   message/<sessionID>/*.json { id, role, time, summary?, ... }
//   part/<messageID>/*.json    { type, text?, synthetic?, ignored? }
//   project/<id>.json          { id, worktree, vcs }
//
// This layout is undocumented. If opencode changes it, this file is the only
// thing that needs fixing, and `detect()` fails closed rather than silently
// producing an empty corpus.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'opencode'
export const label = 'opencode'

const STORAGE = () =>
  process.env.REFLECT_OPENCODE_STORAGE ||
  path.join(os.homedir(), '.local/share/opencode/storage')

// Slash-command expansions are not flagged synthetic; the real input follows
// this wrapper. Discovered by finding command template text ranked as if it
// were the user's own most-repeated phrasing.
const CMD_WRAPPER = /^The user input can be provided directly[\s\S]*?User input:\s*/i

const readJSON = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

const walk = (dir) => {
  let out = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(full))
    else out.push(full)
  }
  return out
}

export function detect() {
  const s = STORAGE()
  return ['session', 'message', 'part'].every((d) => fs.existsSync(path.join(s, d)))
}

export function describe() {
  const s = STORAGE()
  if (!detect()) return { present: false, root: s }
  let sessions = 0
  for (const f of walk(path.join(s, 'session'))) {
    const j = readJSON(f)
    if (j?.id && !j.parentID) sessions++
  }
  return { present: true, root: s, topLevelSessions: sessions }
}

export function load({ since = 0 } = {}) {
  const S = STORAGE()

  // Canonical repo root per project. opencode already resolves worktrees to one
  // project, so this is authoritative — no path-name guessing. The `global`
  // project is a catch-all for non-repo directories.
  const projects = new Map()
  for (const f of walk(path.join(S, 'project'))) {
    const j = readJSON(f)
    if (j?.id) projects.set(j.id, j.worktree ?? null)
  }

  const out = []
  for (const f of walk(path.join(S, 'session'))) {
    const meta = readJSON(f)
    if (!meta?.id) continue
    if (meta.parentID) continue // subagent session: "user" messages were written by the agent

    const msgDir = path.join(S, 'message', meta.id)
    let msgFiles
    try {
      msgFiles = fs.readdirSync(msgDir)
    } catch {
      continue
    }

    const messages = []
    for (const mf of msgFiles) {
      const m = readJSON(path.join(msgDir, mf))
      // `m.summary.diffs` can embed whole file contents. Never read it.
      if (!m || m.role !== 'user') continue
      let partFiles
      try {
        partFiles = fs.readdirSync(path.join(S, 'part', m.id))
      } catch {
        continue
      }
      for (const pf of partFiles) {
        const pt = readJSON(path.join(S, 'part', m.id, pf))
        if (!pt || pt.type !== 'text' || typeof pt.text !== 'string') continue
        if (pt.synthetic === true || pt.ignored === true) continue
        const text = pt.text.replace(CMD_WRAPPER, '').trim()
        if (text.length < 2) continue
        messages.push({ at: m.time?.created ?? 0, text })
      }
    }
    if (!messages.length) continue
    messages.sort((a, b) => a.at - b.at)

    const latest = messages[messages.length - 1].at
    if (latest <= since) continue

    const dir = meta.directory ?? '(unknown)'
    const repo =
      !meta.projectID || meta.projectID === 'global'
        ? dir
        : (projects.get(meta.projectID) ?? dir)

    out.push({
      id: meta.id,
      harness: name,
      project: dir,
      repo,
      title: meta.title ?? '(untitled)',
      createdAt: meta.time?.created ?? latest,
      messages,
    })
  }
  return out
}

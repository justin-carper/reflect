// opencode adapter.
//
// Storage: opencode keeps session state in SQLite at
//   ~/.local/share/opencode/opencode.db
//
//   session   id, parent_id, directory, project_id, title, time_created, time_updated
//   message   id, session_id, time_created, data   -- data JSON holds { role, ... }
//   part      id, message_id, session_id, data     -- data JSON holds { type, text?, synthetic?, ignored? }
//   project   id, worktree, vcs
//
// Before 2026-02 opencode used a JSON file tree under
// ~/.local/share/opencode/storage/{session,message,part}/. That tree is left in
// place when opencode migrates, so testing for those directories reports a live
// store that has not been written to since the migration. An earlier version of
// this adapter did exactly that and produced an empty corpus indefinitely, which
// the CLI then reported as the valid "nothing to reflect on" outcome.
//
// So `detect()` requires the database to hold sessions, not merely to exist, and
// `describe()` reports last activity so a future move is visible in `doctor`.
//
// This layout is undocumented. If opencode changes it, this file is the only
// thing that needs fixing.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const name = 'opencode'
export const label = 'opencode'

const DB = () =>
  process.env.REFLECT_OPENCODE_DB || path.join(os.homedir(), '.local/share/opencode/opencode.db')

// Slash-command expansions are not flagged synthetic; the real input follows
// this wrapper. Discovered by finding command template text ranked as if it
// were the user's own most-repeated phrasing.
const CMD_WRAPPER = /^The user input can be provided directly[\s\S]*?User input:\s*/i

// Notifications from opencode's pty plugin arrive under the user role as plain
// text, and are the one injected envelope opencode does not flag synthetic --
// skill blocks, file attachments and system reminders all are. Left in, they
// outnumber real messages in any session that watched a build or a test run.
const PTY_NOTICE = /^<pty_(?:exited|output)>/

// node:sqlite arrived in Node 22.5. Loading it lazily keeps this adapter from
// crashing the CLI for someone who only uses Claude Code on an older runtime;
// detect() simply reports absent and doctor() explains why.
let sqliteModule
const sqlite = () => {
  if (sqliteModule !== undefined) return sqliteModule
  try {
    sqliteModule = require('node:sqlite')
  } catch {
    sqliteModule = null
  }
  return sqliteModule
}

const open = () => {
  const mod = sqlite()
  if (!mod) return null
  const file = DB()
  if (!fs.existsSync(file)) return null
  try {
    return new mod.DatabaseSync(file, { readOnly: true })
  } catch {
    return null
  }
}

// count(*) over session doubles as a schema probe: a database that is not an
// opencode store throws here rather than returning a misleading zero.
const sessionCount = (db) => {
  try {
    return db.prepare('SELECT count(*) AS n FROM session').get()?.n ?? 0
  } catch {
    return 0
  }
}

export function detect() {
  const db = open()
  if (!db) return false
  try {
    return sessionCount(db) > 0
  } finally {
    db.close()
  }
}

export function describe() {
  const root = DB()
  if (!sqlite()) {
    return {
      present: false,
      root,
      note: `needs Node >= 22.5 for node:sqlite (running ${process.version})`,
    }
  }
  const db = open()
  if (!db) return { present: false, root }
  try {
    const topLevelSessions =
      db.prepare('SELECT count(*) AS n FROM session WHERE parent_id IS NULL').get()?.n ?? 0
    if (!topLevelSessions) return { present: false, root, note: 'database holds no sessions' }
    const last = db.prepare('SELECT max(time_updated) AS t FROM session').get()?.t ?? 0
    return {
      present: true,
      root,
      topLevelSessions,
      lastActivity: last ? new Date(last).toISOString() : 'unknown',
    }
  } catch (e) {
    return { present: false, root, note: `unreadable (${e.message})` }
  } finally {
    db.close()
  }
}

// json_extract raises "malformed JSON" and aborts the whole statement when any
// scanned row holds an invalid payload, so every use is guarded. CASE is what
// makes the guard ordered; a plain `json_valid(x) AND json_extract(x, ...)` is
// still subject to the planner reordering the two terms.
const jsonField = (col, key) =>
  `CASE WHEN json_valid(${col}) THEN json_extract(${col}, '$.${key}') END`

export function load({ since = 0 } = {}) {
  const db = open()
  if (!db) return []

  // Deliberately not wrapped in a catch-all: malformed payloads are handled by
  // the guards above and by JSON.parse below, so anything still throwing here is
  // a schema change, and must surface instead of yielding an empty corpus.
  try {
    // Canonical repo root per project. opencode already resolves worktrees to one
    // project, so this is authoritative — no path-name guessing. The `global`
    // project is a catch-all for non-repo directories.
    const projects = new Map()
    for (const row of db.prepare('SELECT id, worktree FROM project').all()) {
      projects.set(row.id, row.worktree ?? null)
    }

    // The window is applied in SQL: pull a session only if it holds a human
    // message newer than `since`. Subagent sessions are excluded here — their
    // "user" messages were written by the agent.
    const sessionRows = db
      .prepare(
        `SELECT s.id, s.directory, s.project_id, s.title, s.time_created
           FROM session s
          WHERE s.parent_id IS NULL
            AND EXISTS (
                  SELECT 1 FROM message m
                   WHERE m.session_id = s.id
                     AND m.time_created > ?
                     AND ${jsonField('m.data', 'role')} = 'user'
                )
          ORDER BY s.time_created`,
      )
      .all(since)

    // `m.summary.diffs` can embed whole file contents; selecting only text parts
    // of user messages means it is never read.
    const partsStmt = db.prepare(
      `SELECT m.time_created AS at, p.data AS data
         FROM part p JOIN message m ON m.id = p.message_id
        WHERE p.session_id = ?
          AND ${jsonField('m.data', 'role')} = 'user'
          AND ${jsonField('p.data', 'type')} = 'text'
        ORDER BY m.time_created, p.id`,
    )

    const out = []
    for (const meta of sessionRows) {
      const messages = []
      for (const row of partsStmt.all(meta.id)) {
        let pt
        try {
          pt = JSON.parse(row.data)
        } catch {
          continue
        }
        if (!pt || typeof pt.text !== 'string') continue
        if (pt.synthetic === true || pt.ignored === true) continue
        const text = pt.text.replace(CMD_WRAPPER, '').trim()
        if (PTY_NOTICE.test(text)) continue
        if (text.length < 2) continue
        messages.push({ at: row.at ?? 0, text })
      }
      if (!messages.length) continue
      messages.sort((a, b) => a.at - b.at)

      // A session can hold a post-watermark message whose every part is filtered
      // out, so this is re-checked against surviving messages.
      const latest = messages[messages.length - 1].at
      if (latest <= since) continue

      const dir = meta.directory ?? '(unknown)'
      const repo =
        !meta.project_id || meta.project_id === 'global'
          ? dir
          : (projects.get(meta.project_id) ?? dir)

      out.push({
        id: meta.id,
        harness: name,
        project: dir,
        repo,
        title: meta.title ?? '(untitled)',
        createdAt: meta.time_created ?? latest,
        messages,
      })
    }
    return out
  } finally {
    db.close()
  }
}

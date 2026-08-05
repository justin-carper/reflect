#!/usr/bin/env node
// reflect — build a reflection corpus from your agent's own session history.
//
// This tool never calls a model. It finds the sessions where you corrected your
// agent, writes them to a file, and prints the prompt to hand to whatever agent
// you already use. Your agent does the reasoning; you keep your own model,
// your own keys, and your own data.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { adapters, byName, detected } from './adapters/index.mjs'
import { build, toMarkdown } from './corpus.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.join(HERE, '..')

const argv = process.argv.slice(2)
const cmd = argv[0]
const has = (f) => argv.includes(f)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}

const defaultStateDir = () => {
  if (process.env.REFLECT_STATE_DIR) return process.env.REFLECT_STATE_DIR
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'reflect')
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'reflect')
}

const STATE_DIR = val('--state-dir', defaultStateDir())
const STATE_FILE = path.join(STATE_DIR, 'state.json')

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}
const writeState = (patch) => {
  const next = { ...readState(), ...patch }
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2))
  return next
}

const chosenAdapters = () => {
  const only = val('--harness', null)
  if (only) {
    const a = byName(only)
    if (!a.detect()) {
      console.error(`harness "${only}" not detected on this machine. run: reflect doctor`)
      process.exit(2)
    }
    return [a]
  }
  const found = detected()
  if (!found.length) {
    console.error('no supported harness detected. run: reflect doctor')
    process.exit(2)
  }
  return found
}

const loadSessions = (since) => {
  const used = chosenAdapters()
  let sessions = []
  for (const a of used) sessions = sessions.concat(a.load({ since }))
  return { sessions, harnesses: used.map((a) => a.label) }
}

const HELP = `reflect — find the sessions where you corrected your agent

Usage:
  reflect doctor                     show which harnesses are detected
  reflect build [options]            write the corpus, print stats
  reflect count [options]            print qualifying session count only
  reflect prompt                     print the reflection prompt
  reflect mark-reflected             stamp now as the incremental watermark

Options:
  --with-path PATH    corpus path to embed in the prompt (default <state-dir>/corpus.md)
  --reports-dir PATH  where the analyzer should write its report
  --harness NAME      opencode | claude-code  (default: every detected harness)
  --all               ignore the incremental watermark, use full history
  --min-signal N      corrective messages required per session (default 2)
  --out PATH          corpus destination (default <state-dir>/corpus.md)
  --state-dir PATH    state + default output location
  --max-chars N       per-message truncation (default 700)

Environment:
  REFLECT_STATE_DIR             override state directory
  REFLECT_OPENCODE_DB           override opencode session database path
  REFLECT_CLAUDE_PROJECTS      override Claude Code projects root
`

function doctor() {
  console.log(`state dir: ${STATE_DIR}`)
  const st = readState()
  console.log(
    `watermark: ${st.lastReflectedAt ? new Date(st.lastReflectedAt).toISOString() : '(unset — next build uses full history)'}`,
  )
  console.log('')
  let any = false
  for (const a of adapters) {
    let info
    try {
      info = a.describe()
    } catch (e) {
      info = { present: false, error: e.message }
    }
    if (info.present) any = true
    const extra = Object.entries(info)
      .filter(([k]) => !['present', 'root'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    console.log(`${info.present ? '  found  ' : '  absent '} ${a.label.padEnd(14)} ${info.root}${extra ? '  ' + extra : ''}`)
  }
  if (!any) {
    console.log('')
    console.log('No harness detected. Set an override env var if your data lives elsewhere.')
    process.exitCode = 1
  }
}

function doBuild({ countOnly }) {
  const st = readState()
  const since = has('--all') ? 0 : (st.lastReflectedAt ?? 0)
  const minSignal = parseInt(val('--min-signal', '2'), 10)
  const maxMessageChars = parseInt(val('--max-chars', '700'), 10)
  const out = val('--out', path.join(STATE_DIR, 'corpus.md'))

  const { sessions, harnesses } = loadSessions(since)
  const result = build(sessions, { minSignal, maxMessageChars })

  if (countOnly) {
    console.log(result.stats.qualifying)
    return
  }

  const md = toMarkdown(result, { since, harnesses })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, md)

  const bytes = fs.statSync(out).size
  const s = result.stats
  console.log(`corpus:   ${out}`)
  console.log(`harness:  ${harnesses.join(', ')}`)
  console.log(`sessions: ${s.qualifying} (of ${s.considered} top-level in window)`)
  console.log(`messages: ${s.messages}`)
  console.log(`size:     ${(bytes / 1024).toFixed(0)} KB (~${Math.round(bytes / 4000)}k tokens)`)
  console.log(
    `dropped:  ${s.repeatsDropped} verbatim repeats, ${s.duplicateSessionsDropped} near-duplicate sessions`,
  )
  console.log(`repos:    ${s.repos.length}${s.repos.length ? `, largest share ${s.topShare}%` : ''}`)
  if (s.topShare >= 70 && s.qualifying > 0) {
    console.log('')
    console.log(
      `NOTE: ${s.topShare}% of this corpus is one repo. Findings will skew toward that repo's conventions. Weight candidates by how many distinct repos support them.`,
    )
  }
  if (!s.qualifying) {
    console.log('')
    console.log('No qualifying sessions. Nothing to reflect on — this is a valid outcome.')
  }
}

function printPrompt() {
  const p = path.join(PKG_ROOT, 'prompts/reflector.md')
  let text = fs.readFileSync(p, 'utf8')
  const corpus = val('--with-path', path.join(STATE_DIR, 'corpus.md'))
  const reports = val('--reports-dir', path.join(STATE_DIR, 'reports'))
  text = text.replace(/\{\{CORPUS_PATH\}\}/g, corpus).replace(/\{\{REPORTS_DIR\}\}/g, reports)
  // The analyzer is expected to have write access to this directory and nowhere
  // else, so make sure it exists rather than making the agent create it.
  fs.mkdirSync(reports, { recursive: true })
  console.log(text)
}

try {
  switch (cmd) {
    case 'doctor':
      doctor()
      break
    case 'build':
      doBuild({ countOnly: false })
      break
    case 'count':
      doBuild({ countOnly: true })
      break
    case 'prompt':
      printPrompt()
      break
    case 'mark-reflected': {
      const st = writeState({ lastReflectedAt: Date.now() })
      console.log(`watermark set: ${new Date(st.lastReflectedAt).toISOString()}`)
      console.log('the next build covers only sessions after this point (use --all to override)')
      break
    }
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP)
      break
    default:
      console.error(`unknown command "${cmd}"\n`)
      console.log(HELP)
      process.exitCode = 1
  }
} catch (e) {
  console.error(`reflect: ${e.message}`)
  process.exitCode = 1
}

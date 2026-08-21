// All fixtures here are synthetic and written at test time. No real transcript
// data is committed to this repo — real sessions contain private code and
// conversation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

import * as opencode from '../src/adapters/opencode.mjs'
import * as claudeCode from '../src/adapters/claude-code.mjs'
import * as pi from '../src/adapters/pi.mjs'
import { build } from '../src/corpus.mjs'
import { signalCounts } from '../src/lexicon.mjs'
import { dropRepeats, dropNearDuplicateSessions } from '../src/dedupe.mjs'

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `reflect-${name}-`))
const write = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj))
}

// ---------------------------------------------------------------- opencode

// opencode stores sessions in SQLite. The fixture builds a real database so the
// adapter's SQL is exercised, not a stand-in for it.
function opencodeFixture() {
  const file = path.join(tmp('oc'), 'opencode.db')
  const db = new DatabaseSync(file)

  db.exec(`
    CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, vcs text);
    CREATE TABLE session (
      id text PRIMARY KEY, project_id text NOT NULL, parent_id text,
      directory text NOT NULL, title text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL
    );
    CREATE TABLE message (
      id text PRIMARY KEY, session_id text NOT NULL,
      time_created integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
      data text NOT NULL
    );
  `)

  const project = db.prepare('INSERT INTO project VALUES (?,?,?)')
  const session = db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?)')
  const message = db.prepare('INSERT INTO message VALUES (?,?,?,?)')
  const part = db.prepare('INSERT INTO part VALUES (?,?,?,?)')
  const msg = (id, session_id, at, role) =>
    message.run(id, session_id, at, JSON.stringify({ role, time: { created: at } }))
  const txt = (id, message_id, session_id, data) =>
    part.run(id, message_id, session_id, JSON.stringify(data))

  project.run('p1', '/repo/main', 'git')

  // top-level session, living in a worktree of p1
  session.run('s1', 'p1', null, '/repo/worktrees/featureA', 'Fix the thing', 1000, 1400)
  // subagent session — must be excluded entirely
  session.run('s2', 'p1', 's1', '/repo/main', 'subagent', 1005, 1010)

  // human message with one real part and three that must be filtered
  msg('m1', 's1', 1100, 'user')
  txt('m1a', 'm1', 's1', { type: 'text', text: 'no, do not use that package' })
  txt('m1b', 'm1', 's1', { type: 'text', synthetic: true, text: 'INJECTED SKILL TEXT' })
  txt('m1c', 'm1', 's1', { type: 'text', ignored: true, text: 'IGNORED PART' })
  txt('m1d', 'm1', 's1', { type: 'file', filename: 'x.png' })

  // slash-command expansion: wrapper must be stripped, tail kept
  msg('m2', 's1', 1200, 'user')
  txt('m2a', 'm2', 's1', {
    type: 'text',
    text:
      'The user input can be provided directly by the agent or as a command argument - you **MUST** consider it before proceeding with the prompt (if not empty).\n\nUser input:\n\nyou keep editing the generated file',
  })

  // assistant message must be ignored
  msg('m3', 's1', 1300, 'assistant')
  txt('m3a', 'm3', 's1', { type: 'text', text: 'assistant reply' })

  // pty plugin notice: arrives under the user role and is NOT flagged synthetic
  msg('m5', 's1', 1350, 'user')
  txt('m5a', 'm5', 's1', {
    type: 'text',
    text: '<pty_exited>\nID: pty_abc\nExit Code: 0\nPTY NOTICE BODY',
  })

  // subagent session messages exist but must never be read
  msg('m9', 's2', 1010, 'user')
  txt('m9a', 'm9', 's2', { type: 'text', text: 'AGENT AUTHORED PROMPT' })

  // malformed part payload must not throw
  part.run('m4a', 'm1', 's1', '{ this is not json')

  db.close()
  return file
}

test('opencode adapter: filters injected, ignored, assistant, pty, and subagent content', () => {
  process.env.REFLECT_OPENCODE_DB = opencodeFixture()
  assert.equal(opencode.detect(), true)

  const sessions = opencode.load({ since: 0 })
  assert.equal(sessions.length, 1, 'only the top-level session is returned')

  const s = sessions[0]
  assert.equal(s.id, 's1')
  assert.equal(s.messages.length, 2)

  const texts = s.messages.map((m) => m.text)
  assert.equal(texts[0], 'no, do not use that package')
  assert.equal(texts[1], 'you keep editing the generated file', 'command wrapper is stripped')

  const joined = texts.join('\n')
  for (const forbidden of [
    'INJECTED SKILL TEXT',
    'IGNORED PART',
    'assistant reply',
    'AGENT AUTHORED PROMPT',
    'PTY NOTICE BODY',
  ]) {
    assert.ok(!joined.includes(forbidden), `must exclude: ${forbidden}`)
  }
})

test('opencode adapter: repo collapses worktrees to the canonical root', () => {
  process.env.REFLECT_OPENCODE_DB = opencodeFixture()
  const [s] = opencode.load({ since: 0 })
  assert.equal(s.project, '/repo/worktrees/featureA')
  assert.equal(s.repo, '/repo/main', 'worktree maps to the project worktree, not its own path')
})

test('opencode adapter: since filter excludes older sessions', () => {
  process.env.REFLECT_OPENCODE_DB = opencodeFixture()
  assert.equal(opencode.load({ since: 5000 }).length, 0)
  assert.equal(opencode.load({ since: 1150 }).length, 1, 'newest message after watermark keeps it')
})

test('opencode adapter: a session is dropped when every post-watermark part is filtered', () => {
  // m5 (the pty notice) is the only message after 1300, and it does not survive
  // filtering — so the session must not be pulled in on its account.
  process.env.REFLECT_OPENCODE_DB = opencodeFixture()
  assert.deepEqual(opencode.load({ since: 1300 }), [])
})

test('opencode adapter: detect fails closed when the database is absent', () => {
  process.env.REFLECT_OPENCODE_DB = path.join(tmp('oc-empty'), 'nope.db')
  assert.equal(opencode.detect(), false)
  assert.deepEqual(opencode.load({ since: 0 }), [])
})

test('opencode adapter: detect fails closed on an abandoned store, not just a missing one', () => {
  // The regression this guards: opencode leaves its pre-2026-02 JSON tree on disk
  // after migrating, and an empty-but-present store must not read as healthy.
  // Full schema, zero rows — what a store looks like once its data lives elsewhere.
  const file = path.join(tmp('oc-dead'), 'opencode.db')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, vcs text);
    CREATE TABLE session (
      id text PRIMARY KEY, project_id text NOT NULL, parent_id text,
      directory text NOT NULL, title text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL
    );
    CREATE TABLE message (
      id text PRIMARY KEY, session_id text NOT NULL,
      time_created integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
      data text NOT NULL
    );
  `)
  db.close()

  process.env.REFLECT_OPENCODE_DB = file
  assert.equal(opencode.detect(), false, 'a store with no sessions is not a live store')
  assert.equal(opencode.describe().present, false)
  assert.deepEqual(opencode.load({ since: 0 }), [])
})

test('opencode adapter: describe reports last activity so a dead store is visible', () => {
  process.env.REFLECT_OPENCODE_DB = opencodeFixture()
  const info = opencode.describe()
  assert.equal(info.present, true)
  assert.equal(info.topLevelSessions, 1, 'subagent sessions are not counted')
  assert.equal(info.lastActivity, new Date(1400).toISOString())
})

test('opencode adapter: a database that is not an opencode store is not detected', () => {
  const file = path.join(tmp('oc-wrong'), 'other.db')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE unrelated (x integer); INSERT INTO unrelated VALUES (1)')
  db.close()

  process.env.REFLECT_OPENCODE_DB = file
  assert.equal(opencode.detect(), false)
  assert.equal(opencode.describe().present, false)
  // The CLI only calls load() on a detected harness. If something does reach it
  // with the wrong schema, that must surface rather than read as an empty corpus.
  assert.throws(() => opencode.load({ since: 0 }))
})

test('opencode adapter: a malformed part payload is skipped, not fatal', () => {
  // json_extract aborts the whole statement on an invalid payload, so the fixture
  // carries one and the surviving messages must still come back.
  process.env.REFLECT_OPENCODE_DB = opencodeFixture()
  const [s] = opencode.load({ since: 0 })
  assert.equal(s.messages.length, 2)
})

// ------------------------------------------------------------- claude code

function claudeFixture() {
  const root = path.join(tmp('cc'), 'projects')
  const dir = path.join(root, '-repo-main')
  const base = { sessionId: 'cc1', cwd: '/repo/main', gitBranch: 'main' }
  const lines = [
    { ...base, type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: 'no, that is not the pattern' } },
    { ...base, type: 'user', timestamp: '2026-01-01T00:00:02Z', isMeta: true, message: { content: 'META NOTICE' } },
    {
      ...base,
      type: 'user',
      timestamp: '2026-01-01T00:00:03Z',
      toolUseResult: { stdout: 'x' },
      message: { content: 'TOOL RESULT' },
    },
    {
      ...base,
      type: 'user',
      timestamp: '2026-01-01T00:00:04Z',
      isSidechain: true,
      message: { content: 'SIDECHAIN PROMPT' },
    },
    {
      ...base,
      type: 'user',
      timestamp: '2026-01-01T00:00:05Z',
      sourceToolUseID: 'tu_1',
      message: { content: 'TOOL GENERATED' },
    },
    { ...base, type: 'assistant', timestamp: '2026-01-01T00:00:06Z', message: { content: 'ASSISTANT REPLY' } },
    {
      ...base,
      type: 'user',
      timestamp: '2026-01-01T00:00:07Z',
      message: { content: [{ type: 'text', text: 'you keep doing that' }, { type: 'image', source: {} }] },
    },
    { ...base, type: 'ai-title', aiTitle: 'Generated title' },
    'not json at all',
    '',
  ]
  write(
    path.join(dir, 'cc1.jsonl'),
    lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'),
  )
  return root
}

test('claude-code adapter: filters meta, tool results, sidechain, and tool-generated records', () => {
  process.env.REFLECT_CLAUDE_PROJECTS = claudeFixture()
  assert.equal(claudeCode.detect(), true)

  const sessions = claudeCode.load({ since: 0 })
  assert.equal(sessions.length, 1)

  const s = sessions[0]
  assert.equal(s.id, 'cc1')
  assert.equal(s.title, 'Generated title')
  assert.equal(s.repo, '/repo/main')
  assert.equal(s.messages.length, 2)
  assert.deepEqual(
    s.messages.map((m) => m.text),
    ['no, that is not the pattern', 'you keep doing that'],
  )

  const joined = s.messages.map((m) => m.text).join('\n')
  for (const forbidden of ['META NOTICE', 'TOOL RESULT', 'SIDECHAIN PROMPT', 'TOOL GENERATED', 'ASSISTANT REPLY']) {
    assert.ok(!joined.includes(forbidden), `must exclude: ${forbidden}`)
  }
})

test('claude-code adapter: malformed lines do not throw', () => {
  process.env.REFLECT_CLAUDE_PROJECTS = claudeFixture()
  assert.doesNotThrow(() => claudeCode.load({ since: 0 }))
})

test('claude-code adapter: detect fails closed when projects dir is absent', () => {
  process.env.REFLECT_CLAUDE_PROJECTS = path.join(tmp('cc-empty'), 'nope')
  assert.equal(claudeCode.detect(), false)
  assert.deepEqual(claudeCode.load({ since: 0 }), [])
})

// --------------------------------------------------------------------- pi

function piFixture() {
  const root = path.join(tmp('pi'), 'sessions')
  const dir = path.join(root, '--repo-main--')
  const iso = (s) => new Date(s).toISOString()
  const ms = (s) => Date.parse(s)
  const lines = [
    { type: 'session', version: 3, id: 'pi1', timestamp: iso('2026-01-01T00:00:00Z'), cwd: '/repo/main' },
    { type: 'model_change', id: 'e01', parentId: null, timestamp: iso('2026-01-01T00:00:00.5Z'), provider: 'p', modelId: 'm' },
    // human message: one text block plus an image block that must be dropped
    {
      type: 'message', id: 'e02', parentId: 'e01', timestamp: iso('2026-01-01T00:00:01Z'),
      message: {
        role: 'user', timestamp: ms('2026-01-01T00:00:01Z'),
        content: [
          { type: 'text', text: 'no, that is not the pattern' },
          { type: 'image', data: 'x', mimeType: 'image/png' },
        ],
      },
    },
    { type: 'message', id: 'e03', parentId: 'e02', timestamp: iso('2026-01-01T00:00:02Z'), message: { role: 'assistant', content: [{ type: 'text', text: 'ASSISTANT REPLY' }] } },
    { type: 'message', id: 'e04', parentId: 'e03', timestamp: iso('2026-01-01T00:00:02Z'), message: { role: 'toolResult', toolCallId: 't1', toolName: 'bash', content: [{ type: 'text', text: 'TOOL RESULT' }], isError: false } },
    { type: 'message', id: 'e05', parentId: 'e04', timestamp: iso('2026-01-01T00:00:02Z'), message: { role: 'bashExecution', command: 'ls', output: 'BASH OUTPUT', exitCode: 0, cancelled: false, truncated: false } },
    { type: 'custom_message', id: 'e06', parentId: 'e05', timestamp: iso('2026-01-01T00:00:02Z'), customType: 'some-ext', content: 'INJECTED EXTENSION TEXT', display: true },
    { type: 'compaction', id: 'e07', parentId: 'e06', timestamp: iso('2026-01-01T00:00:02Z'), summary: 'SUMMARY', tokensBefore: 100, retainedTail: [{ role: 'user', content: 'COMPACTION RETAINED' }] },
    // /skill:x expansion: envelope stripped, typed arguments kept
    {
      type: 'message', id: 'e08', parentId: 'e07', timestamp: iso('2026-01-01T00:00:03Z'),
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: '<skill name="x" location="/skills/x/SKILL.md">\nReferences are relative to /skills/x.\n\nSKILL BODY\n</skill>\n\nyou keep editing the generated file',
        }],
      },
    },
    // /skill:y expansion with no arguments: nothing typed, so nothing survives.
    // Timestamp is after e08 so the since-filter test below can isolate it.
    {
      type: 'message', id: 'e09', parentId: 'e08', timestamp: iso('2026-01-01T00:00:05Z'),
      message: {
        role: 'user',
        content: [{ type: 'text', text: '<skill name="y" location="/skills/y/SKILL.md">\nSKILL BODY ONLY\n</skill>' }],
      },
    },
    { type: 'session_info', id: 'e10', parentId: 'e09', timestamp: iso('2026-01-01T00:00:06Z'), name: 'Fix the thing' },
    'not json at all',
    'null',
    '',
  ]
  write(
    path.join(dir, '2026-01-01T00-00-00-000Z_pi1.jsonl'),
    lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'),
  )

  // Subagent sessions nest under the parent session file's basename. The walk
  // must never read them: their "user" text is a prompt the parent agent wrote.
  write(
    path.join(dir, '2026-01-01T00-00-00-000Z_pi1', 'tasks', 'sub.jsonl'),
    [
      { type: 'session', version: 3, id: 'sub1', timestamp: iso('2026-01-01T00:00:02Z'), cwd: '/repo/main', parentSession: path.join(dir, '2026-01-01T00-00-00-000Z_pi1.jsonl') },
      { type: 'message', id: 's01', parentId: null, timestamp: iso('2026-01-01T00:00:02Z'), message: { role: 'user', content: [{ type: 'text', text: 'AGENT AUTHORED PROMPT' }] } },
    ].map((l) => JSON.stringify(l)).join('\n'),
  )
  return root
}

test('pi adapter: filters non-human content, strips skill envelopes, skips nested subagent files', () => {
  process.env.REFLECT_PI_SESSIONS = piFixture()
  assert.equal(pi.detect(), true)

  const sessions = pi.load({ since: 0 })
  assert.equal(sessions.length, 1, 'only the top-level session is returned')

  const s = sessions[0]
  assert.equal(s.id, 'pi1')
  assert.equal(s.title, 'Fix the thing')
  assert.equal(s.project, '/repo/main')
  assert.equal(s.repo, '/repo/main')
  assert.equal(s.messages.length, 2)
  assert.deepEqual(
    s.messages.map((m) => m.text),
    ['no, that is not the pattern', 'you keep editing the generated file'],
  )
  assert.deepEqual(s.messages.map((m) => m.at), [Date.parse('2026-01-01T00:00:01Z'), Date.parse('2026-01-01T00:00:03Z')])

  const joined = s.messages.map((m) => m.text).join('\n')
  for (const forbidden of [
    'ASSISTANT REPLY',
    'TOOL RESULT',
    'BASH OUTPUT',
    'INJECTED EXTENSION TEXT',
    'COMPACTION RETAINED',
    'AGENT AUTHORED PROMPT',
    'SKILL BODY',
  ]) {
    assert.ok(!joined.includes(forbidden), `must exclude: ${forbidden}`)
  }
})

test('pi adapter: malformed lines do not throw', () => {
  process.env.REFLECT_PI_SESSIONS = piFixture()
  assert.doesNotThrow(() => pi.load({ since: 0 }))
})

test('pi adapter: since filter excludes sessions whose newest surviving message is older', () => {
  process.env.REFLECT_PI_SESSIONS = piFixture()
  assert.equal(pi.load({ since: Date.parse('2026-01-01T00:00:06Z') }).length, 0)
  assert.equal(pi.load({ since: Date.parse('2026-01-01T00:00:01.5Z') }).length, 1)
})

test('pi adapter: a session is dropped when every post-watermark message is filtered', () => {
  // e09 (skill envelope with no arguments) is the only message after 00:00:04Z,
  // and it does not survive filtering — so the session must not be pulled in.
  process.env.REFLECT_PI_SESSIONS = piFixture()
  assert.deepEqual(pi.load({ since: Date.parse('2026-01-01T00:00:04Z') }), [])
})

test('pi adapter: detect fails closed when the sessions root is absent', () => {
  process.env.REFLECT_PI_SESSIONS = path.join(tmp('pi-empty'), 'sessions')
  assert.equal(pi.detect(), false)
  assert.deepEqual(pi.load({ since: 0 }), [])
  assert.equal(pi.describe().present, false)
})

test('pi adapter: describe counts top-level sessions only', () => {
  process.env.REFLECT_PI_SESSIONS = piFixture()
  const info = pi.describe()
  assert.equal(info.present, true)
  assert.equal(info.sessions, 1, 'the nested subagent file is not counted')
  assert.ok(info.lastActivity)
})

// ------------------------------------------------------------------ shared

test('lexicon: counts corrective signal, and directives do not open the gate', () => {
  const c = signalCounts([
    { text: 'no, that is wrong' },
    { text: 'you keep doing that' },
    { text: 'always run the linter' },
    { text: 'add a field to the struct' },
  ])
  assert.equal(c.correction, 1)
  assert.equal(c.friction, 1)
  assert.equal(c.corrective, 2)
  assert.equal(c.directive, 1)
})

test('lexicon: only the head of a long message is scanned', () => {
  const pasted = `${'x'.repeat(900)} no, that is wrong`
  assert.equal(signalCounts([{ text: pasted }]).corrective, 0)
})

test('dedupe: verbatim repeats are dropped, first kept', () => {
  const { messages, dropped } = dropRepeats([
    { at: 1, text: 'do the thing' },
    { at: 2, text: 'do the thing' },
    { at: 3, text: 'something else' },
  ])
  assert.equal(dropped, 1)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].at, 1)
})

test('dedupe: near-duplicate sessions collapse, oldest wins', () => {
  const msgs = [{ at: 1, text: 'no, use the generated mocks instead of writing your own' }]
  const { sessions, duplicatePairs } = dropNearDuplicateSessions([
    { id: 'old', createdAt: 100, messages: msgs },
    { id: 'fork', createdAt: 200, messages: msgs },
    { id: 'other', createdAt: 300, messages: [{ at: 1, text: 'completely unrelated words here' }] },
  ])
  assert.equal(sessions.length, 2)
  assert.equal(duplicatePairs.length, 1)
  assert.ok(sessions.some((s) => s.id === 'old'))
  assert.ok(!sessions.some((s) => s.id === 'fork'))
})

test('corpus: gate requires minSignal corrective messages', () => {
  const mk = (id, texts) => ({
    id,
    harness: 'test',
    project: '/p',
    repo: '/p',
    title: 't',
    createdAt: 1,
    messages: texts.map((text, i) => ({ at: i, text })),
  })
  const sessions = [
    mk('one-hit', ['no, wrong']),
    mk('two-hits', ['no, wrong', 'you keep doing that']),
  ]
  const built = build(sessions, { minSignal: 2 })
  assert.equal(built.stats.qualifying, 1)
  assert.equal(built.sessions[0].id, 'two-hits')
  assert.equal(built.stats.considered, 2)
})

test('corpus: concentration share is computed over repos', () => {
  const mk = (id, repo) => ({
    id,
    harness: 'test',
    project: repo,
    repo,
    title: 't',
    createdAt: Number(id),
    messages: [
      { at: 1, text: `no, that is wrong in ${id}` },
      { at: 2, text: `you keep doing that in ${id}` },
    ],
  })
  const built = build([mk('1', '/a'), mk('2', '/a'), mk('3', '/a'), mk('4', '/b')], { minSignal: 2 })
  assert.equal(built.stats.qualifying, 4)
  assert.equal(built.stats.topShare, 75)
})

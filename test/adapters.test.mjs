// All fixtures here are synthetic and written at test time. No real transcript
// data is committed to this repo — real sessions contain private code and
// conversation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import * as opencode from '../src/adapters/opencode.mjs'
import * as claudeCode from '../src/adapters/claude-code.mjs'
import { build } from '../src/corpus.mjs'
import { signalCounts } from '../src/lexicon.mjs'
import { dropRepeats, dropNearDuplicateSessions } from '../src/dedupe.mjs'

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `reflect-${name}-`))
const write = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj))
}

// ---------------------------------------------------------------- opencode

function opencodeFixture() {
  const S = path.join(tmp('oc'), 'storage')

  write(path.join(S, 'project/p1.json'), { id: 'p1', worktree: '/repo/main', vcs: 'git' })

  // top-level session, living in a worktree of p1
  write(path.join(S, 'session/x/s1.json'), {
    id: 's1',
    projectID: 'p1',
    directory: '/repo/worktrees/featureA',
    title: 'Fix the thing',
    time: { created: 1000 },
  })
  // subagent session — must be excluded entirely
  write(path.join(S, 'session/x/s2.json'), {
    id: 's2',
    parentID: 's1',
    projectID: 'p1',
    directory: '/repo/main',
    title: 'subagent',
    time: { created: 1005 },
  })

  // human message with one real part and two that must be filtered
  write(path.join(S, 'message/s1/m1.json'), { id: 'm1', role: 'user', time: { created: 1100 } })
  write(path.join(S, 'part/m1/a.json'), { type: 'text', text: 'no, do not use that package' })
  write(path.join(S, 'part/m1/b.json'), { type: 'text', synthetic: true, text: 'INJECTED SKILL TEXT' })
  write(path.join(S, 'part/m1/c.json'), { type: 'text', ignored: true, text: 'IGNORED PART' })
  write(path.join(S, 'part/m1/d.json'), { type: 'file', filename: 'x.png' })

  // slash-command expansion: wrapper must be stripped, tail kept
  write(path.join(S, 'message/s1/m2.json'), { id: 'm2', role: 'user', time: { created: 1200 } })
  write(path.join(S, 'part/m2/a.json'), {
    type: 'text',
    text:
      'The user input can be provided directly by the agent or as a command argument - you **MUST** consider it before proceeding with the prompt (if not empty).\n\nUser input:\n\nyou keep editing the generated file',
  })

  // assistant message must be ignored
  write(path.join(S, 'message/s1/m3.json'), { id: 'm3', role: 'assistant', time: { created: 1300 } })
  write(path.join(S, 'part/m3/a.json'), { type: 'text', text: 'assistant reply' })

  // subagent session messages exist but must never be read
  write(path.join(S, 'message/s2/m9.json'), { id: 'm9', role: 'user', time: { created: 1010 } })
  write(path.join(S, 'part/m9/a.json'), { type: 'text', text: 'AGENT AUTHORED PROMPT' })

  // malformed file must not throw
  write(path.join(S, 'message/s1/m4.json'), '{ this is not json')

  return S
}

test('opencode adapter: filters injected, ignored, assistant, and subagent content', () => {
  process.env.REFLECT_OPENCODE_STORAGE = opencodeFixture()
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
  for (const forbidden of ['INJECTED SKILL TEXT', 'IGNORED PART', 'assistant reply', 'AGENT AUTHORED PROMPT']) {
    assert.ok(!joined.includes(forbidden), `must exclude: ${forbidden}`)
  }
})

test('opencode adapter: repo collapses worktrees to the canonical root', () => {
  process.env.REFLECT_OPENCODE_STORAGE = opencodeFixture()
  const [s] = opencode.load({ since: 0 })
  assert.equal(s.project, '/repo/worktrees/featureA')
  assert.equal(s.repo, '/repo/main', 'worktree maps to the project worktree, not its own path')
})

test('opencode adapter: since filter excludes older sessions', () => {
  process.env.REFLECT_OPENCODE_STORAGE = opencodeFixture()
  assert.equal(opencode.load({ since: 5000 }).length, 0)
  assert.equal(opencode.load({ since: 1150 }).length, 1, 'newest message after watermark keeps it')
})

test('opencode adapter: detect fails closed when storage is absent', () => {
  process.env.REFLECT_OPENCODE_STORAGE = path.join(tmp('oc-empty'), 'nope')
  assert.equal(opencode.detect(), false)
  assert.deepEqual(opencode.load({ since: 0 }), [])
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

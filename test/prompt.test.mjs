// The analyzer prompt and the omp triage command are a contract: the command
// triages report sections by heading, so headings, thresholds, and the triage
// steps must stay in sync.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const prompt = fs.readFileSync(path.join(ROOT, 'prompts/reflector.md'), 'utf8')
const ompCommand = fs.readFileSync(path.join(ROOT, 'integrations/omp/commands/reflect.md'), 'utf8')

const F = '### F. Pattern-triggered rule candidates'
const G = '### G. Skill candidates'
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end))

test('report orders D, F, G before the verdict', () => {
  const idx = ['### D.', F, G, '### E. Verdict'].map((h) => prompt.indexOf(h))
  assert.ok(idx.every((i) => i >= 0), `missing heading: ${idx}`)
  assert.deepEqual([...idx].sort((a, b) => a - b), idx)
})

test('F requires 3+ sessions and drafts non-interrupting TTSR rules', () => {
  const f = section(prompt, F, G)
  assert.match(f, /3\+ distinct sessions/)
  assert.match(f, /At most 3/)
  assert.match(f, /interruptMode: never/)
  assert.doesNotMatch(f, /repeatMode/, 'repeatMode is a global ttsr setting, not a rule key')
  assert.match(f, /file path matching the glob/)
  assert.match(f, /no TTSR rules, propose the equivalent hook or check/)
})

test('G requires 2+ sessions and checks installed skills', () => {
  const g = section(prompt, G, '### E. Verdict')
  assert.match(g, /2\+ distinct sessions/)
  assert.match(g, /At most 2/)
  assert.match(g, /installed skill/)
})

test('prompt reads prior rejections and redacts secrets', () => {
  assert.match(prompt, /## Triage outcome/)
  assert.match(prompt, /secret-shaped string/)
})

test('omp command triages F and G and reviews managed skills', () => {
  assert.match(ompCommand, /A, then F, then G/)
  assert.match(ompCommand, /omp ttsr test/)
  assert.match(ompCommand, /writing-skills/)
  assert.match(ompCommand, /managed-skills/)
})

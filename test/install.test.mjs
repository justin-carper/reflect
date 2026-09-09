// Every case here runs install.sh against a throwaway HOME, so your real
// config directories are never touched by the test suite.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'install.sh')

// A fake HOME with both harnesses present, so detection finds them.
const fakeHome = (opts = {}) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-install-'))
  if (opts.opencode !== false) fs.mkdirSync(path.join(home, '.config/opencode'), { recursive: true })
  if (opts.claudeCode !== false) fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  if (opts.pi !== false) fs.mkdirSync(path.join(home, '.pi/agent'), { recursive: true })
  if (opts.omp !== false) fs.mkdirSync(path.join(home, '.omp/agent'), { recursive: true })
  return home
}

const run = (home, args = [], opts = {}) =>
  execFileSync('sh', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: process.env.PATH },
    ...opts,
  })

// Makes @opencode-ai/plugin resolvable inside the fake HOME so --with-nudge
// takes the "already resolvable" branch. Without this the script would run a
// real npm install, which would make the suite slow and network-dependent.
const stubPluginDep = (home) => {
  const dir = path.join(home, '.config/opencode/node_modules/@opencode-ai/plugin')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@opencode-ai/plugin', version: '0.0.0-test', main: 'index.js' }))
  fs.writeFileSync(path.join(dir, 'index.js'), 'export {}\n')
}

const paths = (home) => ({
  link: path.join(home, '.local/bin/reflect'),
  ocCommand: path.join(home, '.config/opencode/commands/reflect.md'),
  ocAgent: path.join(home, '.config/opencode/agent/reflector.md'),
  ocPlugin: path.join(home, '.config/opencode/plugins/reflect-nudge.ts'),
  ccCommand: path.join(home, '.claude/commands/reflect.md'),
  piPrompt: path.join(home, '.pi/agent/prompts/reflect.md'),
  ompCommand: path.join(home, '.omp/agent/commands/reflect.md'),
})

test('install: links the CLI and installs files for detected harnesses', () => {
  const home = fakeHome()
  const out = run(home)
  const p = paths(home)

  assert.equal(fs.lstatSync(p.link).isSymbolicLink(), true)
  assert.equal(fs.readlinkSync(p.link), path.join(ROOT, 'src/cli.mjs'))
  assert.equal(fs.existsSync(p.ocCommand), true)
  assert.equal(fs.existsSync(p.ocAgent), true)
  assert.equal(fs.existsSync(p.ccCommand), true)
  assert.equal(fs.existsSync(p.piPrompt), true)
  assert.equal(fs.existsSync(p.ompCommand), true)

  // The nudge plugin is opt-in; a plain install must not write it.
  assert.equal(fs.existsSync(p.ocPlugin), false)

  assert.match(out, /installed/)
  assert.match(out, /Next: reflect doctor/)
})

test('install: installed files are byte-identical to the repo copies', () => {
  const home = fakeHome()
  run(home)
  const p = paths(home)

  for (const [dest, src] of [
    [p.ocCommand, 'integrations/opencode/commands/reflect.md'],
    [p.ocAgent, 'integrations/opencode/agent/reflector.md'],
    [p.ccCommand, 'integrations/claude-code/commands/reflect.md'],
    [p.piPrompt, 'integrations/pi/prompts/reflect.md'],
    [p.ompCommand, 'integrations/omp/commands/reflect.md'],
  ]) {
    assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(path.join(ROOT, src), 'utf8'))
  }
})

test('install: is idempotent — second run reports up to date and rewrites nothing', () => {
  const home = fakeHome()
  run(home)
  const p = paths(home)

  const before = [p.ocCommand, p.ocAgent, p.ccCommand, p.piPrompt, p.ompCommand].map((f) => fs.statSync(f).mtimeMs)
  const out = run(home)
  const after = [p.ocCommand, p.ocAgent, p.ccCommand, p.piPrompt, p.ompCommand].map((f) => fs.statSync(f).mtimeMs)

  assert.deepEqual(after, before, 'a re-run must not rewrite unchanged files')
  assert.match(out, /up to date/)
  assert.doesNotMatch(out, /installed {6}/)
  assert.match(out, /0 installed, 0 updated, 6 up to date, 0 skipped/)
})

test('install: a locally modified file is skipped, not clobbered', () => {
  const home = fakeHome()
  run(home)
  const p = paths(home)

  fs.writeFileSync(p.ocCommand, '# my own version\n')
  const out = run(home)

  assert.equal(fs.readFileSync(p.ocCommand, 'utf8'), '# my own version\n')
  assert.match(out, /skipped/)
  assert.match(out, /modified locally/)
  assert.match(out, /1 skipped/)
})

test('install: --force overwrites a modified file', () => {
  const home = fakeHome()
  run(home)
  const p = paths(home)

  fs.writeFileSync(p.ocCommand, '# my own version\n')
  const out = run(home, ['--force'])

  assert.equal(
    fs.readFileSync(p.ocCommand, 'utf8'),
    fs.readFileSync(path.join(ROOT, 'integrations/opencode/commands/reflect.md'), 'utf8'),
  )
  assert.match(out, /overwritten/)
})

test('install: --dry-run changes nothing', () => {
  const home = fakeHome()
  const out = run(home, ['--dry-run'])
  const p = paths(home)

  assert.equal(fs.existsSync(p.link), false)
  assert.equal(fs.existsSync(p.ocCommand), false)
  assert.equal(fs.existsSync(p.ccCommand), false)
  assert.match(out, /would link/)
  assert.match(out, /would install/)
})

test('install: --harness limits the scope', () => {
  const home = fakeHome()
  run(home, ['--harness', 'claude-code'])
  const p = paths(home)

  assert.equal(fs.existsSync(p.ccCommand), true)
  assert.equal(fs.existsSync(p.ocCommand), false)
  assert.equal(fs.existsSync(p.piPrompt), false)
  assert.equal(fs.existsSync(p.ompCommand), false)
})

test('install: --with-nudge adds the plugin file and skips a satisfied dependency', () => {
  const home = fakeHome()
  stubPluginDep(home)
  const out = run(home, ['--with-nudge'])

  assert.equal(fs.existsSync(paths(home).ocPlugin), true)
  assert.match(out, /already resolvable/)
  assert.doesNotMatch(out, /installing {6}@opencode-ai/)
})

test('install: --with-nudge reports the npm install it would run', () => {
  const home = fakeHome()
  const out = run(home, ['--with-nudge', '--dry-run'])

  assert.match(out, /would run {7}npm install @opencode-ai\/plugin/)
  assert.equal(fs.existsSync(paths(home).ocPlugin), false)
})

test('install: no harness present still installs the CLI', () => {
  const home = fakeHome({ opencode: false, claudeCode: false, pi: false, omp: false })
  const out = run(home)

  assert.equal(fs.lstatSync(paths(home).link).isSymbolicLink(), true)
  assert.match(out, /No supported harness found/)
})

test('install: refuses to clobber a real file at the bin path', () => {
  const home = fakeHome()
  const link = paths(home).link
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.writeFileSync(link, '#!/bin/sh\necho not mine\n')

  assert.throws(
    () => run(home, [], { stdio: 'pipe' }),
    (e) => /exists and is not a symlink/.test(e.stderr ?? ''),
  )
  assert.equal(fs.readFileSync(link, 'utf8'), '#!/bin/sh\necho not mine\n')
})

test('uninstall: removes what it installed and keeps what you changed', () => {
  const home = fakeHome()
  stubPluginDep(home)
  run(home, ['--with-nudge'])
  const p = paths(home)

  fs.writeFileSync(p.ocAgent, '# edited\n')
  const out = run(home, ['--uninstall'])

  assert.equal(fs.existsSync(p.link), false)
  assert.equal(fs.existsSync(p.ocCommand), false)
  assert.equal(fs.existsSync(p.ccCommand), false)
  assert.equal(fs.existsSync(p.piPrompt), false)
  assert.equal(fs.existsSync(p.ocPlugin), false)
  assert.equal(fs.readFileSync(p.ocAgent, 'utf8'), '# edited\n', 'an edited file must survive uninstall')
  assert.match(out, /kept/)
  assert.match(out, /state directory was left alone/)
})

test('uninstall: leaves a symlink that points somewhere else alone', () => {
  const home = fakeHome()
  const p = paths(home)
  fs.mkdirSync(path.dirname(p.link), { recursive: true })
  fs.symlinkSync('/somewhere/else/reflect', p.link)

  const out = run(home, ['--uninstall'])

  assert.equal(fs.readlinkSync(p.link), '/somewhere/else/reflect')
  assert.match(out, /points elsewhere/)
})

// A throwaway copy of the repo's installable surface, so a test can simulate
// upstream shipping a new version of an integration file without touching the
// real checkout.
const fakeCheckout = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-checkout-'))
  fs.cpSync(path.join(ROOT, 'integrations'), path.join(dir, 'integrations'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'src/cli.mjs'), path.join(dir, 'src/cli.mjs'))
  fs.copyFileSync(SCRIPT, path.join(dir, 'install.sh'))
  return dir
}

const runFrom = (checkout, home, args = []) =>
  execFileSync('sh', [path.join(checkout, 'install.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: process.env.PATH },
  })

test('update: a file this script wrote is updated when the repo moves on', () => {
  const checkout = fakeCheckout()
  const home = fakeHome()
  const upstream = path.join(checkout, 'integrations/claude-code/commands/reflect.md')

  runFrom(checkout, home, ['--harness', 'claude-code'])
  fs.appendFileSync(upstream, '\n<!-- new upstream version -->\n')

  const out = runFrom(checkout, home, ['--harness', 'claude-code'])

  assert.match(out, /updated/)
  assert.match(
    fs.readFileSync(paths(home).ccCommand, 'utf8'),
    /new upstream version/,
    'an upstream change must reach the installed file',
  )
})

test('update: your edit wins over an upstream change', () => {
  const checkout = fakeCheckout()
  const home = fakeHome()
  const upstream = path.join(checkout, 'integrations/claude-code/commands/reflect.md')

  runFrom(checkout, home, ['--harness', 'claude-code'])
  fs.appendFileSync(paths(home).ccCommand, '\n<!-- my own edit -->\n')
  fs.appendFileSync(upstream, '\n<!-- new upstream version -->\n')

  const out = runFrom(checkout, home, ['--harness', 'claude-code'])
  const installed = fs.readFileSync(paths(home).ccCommand, 'utf8')

  assert.match(out, /skipped/)
  assert.match(installed, /my own edit/, 'your edit must survive')
  assert.doesNotMatch(installed, /new upstream version/, 'upstream must not be applied over your edit')
})

test('update: a hand-installed file becomes updatable once it matches', () => {
  const checkout = fakeCheckout()
  const home = fakeHome()
  const upstream = path.join(checkout, 'integrations/claude-code/commands/reflect.md')
  const dest = paths(home).ccCommand

  // Simulate someone who followed the README's cp instructions before ever
  // running this script: the file exists and matches, but no manifest entry.
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(upstream, dest)

  const first = runFrom(checkout, home, ['--harness', 'claude-code'])
  assert.match(first, /up to date/)

  fs.appendFileSync(upstream, '\n<!-- new upstream version -->\n')
  const second = runFrom(checkout, home, ['--harness', 'claude-code'])

  assert.match(second, /updated/)
  assert.match(fs.readFileSync(dest, 'utf8'), /new upstream version/)
})

test('install: rejects an unknown harness name', () => {
  const home = fakeHome()
  assert.throws(
    () => run(home, ['--harness', 'emacs'], { stdio: 'pipe' }),
    (e) => /unknown harness/.test(e.stderr ?? ''),
  )
})

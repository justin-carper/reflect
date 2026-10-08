import type { Plugin } from '@opencode-ai/plugin'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Optional. Reminds you to run /reflect once enough qualifying sessions have
// accumulated. Everything else works without it.
//
// This plugin contains no corpus logic. It shells out to `reflect count`, which
// is the single source of truth for what counts as a qualifying session, so the
// nudge threshold and the corpus can never disagree.
//
// It never throws: a throw inside an opencode event hook can kill the session,
// and a reminder is not worth that risk. Because errors are swallowed, every
// branch leaves a trace in nudge.log instead — that log is how you debug it.

const STATE_DIR =
  process.env.REFLECT_STATE_DIR ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'reflect')
const STATE = path.join(STATE_DIR, 'state.json')
const LOG = path.join(STATE_DIR, 'nudge.log')

const THRESHOLD = Number(process.env.REFLECT_NUDGE_THRESHOLD ?? 20)
const COOLDOWN_MS = Number(process.env.REFLECT_NUDGE_COOLDOWN_MS ?? 24 * 60 * 60 * 1000)
// Bounds how often the counting command runs, independent of whether a nudge is
// shown. session.idle fires often; without this the plugin would spawn a process
// on every idle event while the count sat below the threshold.
const CHECK_INTERVAL_MS = Number(process.env.REFLECT_NUDGE_CHECK_INTERVAL_MS ?? 30 * 60 * 1000)

type State = { lastReflectedAt?: number; lastNudgeAt?: number; lastCheckAt?: number }

const trace = (msg: string) => {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* nothing left to do */
  }
}

const readState = (): State => {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8')) as State
  } catch {
    return {}
  }
}

const writeState = (patch: State) => {
  try {
    const next = { ...readState(), ...patch }
    fs.mkdirSync(path.dirname(STATE), { recursive: true })
    fs.writeFileSync(STATE, JSON.stringify(next, null, 2))
  } catch {
    /* non-fatal: worst case we nudge again after the cooldown */
  }
}

// Prefer `reflect` on PATH; fall back to a checkout pointed at by REFLECT_HOME.
const findRunner = async (): Promise<string[] | null> => {
  const onPath = await new Promise<boolean>((resolve) => execFile('reflect', ['--help'], (err) => resolve(!err)))
  if (onPath) return ['reflect']
  const home = process.env.REFLECT_HOME
  const cli = home ? path.join(home, 'src/cli.mjs') : null
  return cli && fs.existsSync(cli) ? ['node', cli] : null
}

// Shared by both opencode generations: throttle, cooldown, count, then toast.
// Never throws.
const nudgeIfDue = async (runner: string[], eventType: string, toast: (message: string) => unknown) => {
  try {
    const state = readState()
    const now = Date.now()

    if (state.lastCheckAt && now - state.lastCheckAt < CHECK_INTERVAL_MS) return
    writeState({ lastCheckAt: now })
    trace(`event: ${eventType} — running check`)

    if (state.lastNudgeAt && now - state.lastNudgeAt < COOLDOWN_MS) {
      trace(`skip: cooldown, last nudge ${Math.round((now - state.lastNudgeAt) / 1000)}s ago`)
      return
    }

    const [cmd, ...args] = runner
    const raw = await new Promise<string>((resolve) =>
      execFile(cmd, [...args, 'count', '--harness', 'opencode'], (_err, stdout) => resolve(String(stdout ?? '').trim())),
    )
    const count = parseInt(raw, 10)
    trace(`count: raw="${raw}" parsed=${count} threshold=${THRESHOLD}`)
    if (!Number.isFinite(count) || count < THRESHOLD) {
      trace('skip: under threshold or unparseable')
      return
    }

    await toast(`${count} sessions with corrective feedback since your last pass. Run /reflect.`)
    trace('toast: shown')

    writeState({ lastNudgeAt: now })
    trace('state: lastNudgeAt written')
  } catch (e) {
    trace(`error: ${(e as Error)?.message ?? String(e)}`)
  }
}

const ReflectNudgePlugin: Plugin = async ({ client }) => {
  const runner = await findRunner()
  if (!runner) {
    trace('init: reflect not found on PATH and REFLECT_HOME unset — plugin inert')
    return {}
  }
  trace(`init: loaded (runner: ${runner.join(' ')})`)

  return {
    event: async ({ event }) => {
      // session.created alone is not enough: resuming a session — the common
      // case — never fires it. session.idle fires in any session actually in
      // use, which is what makes the reminder reachable at all.
      if (event.type !== 'session.created' && event.type !== 'session.idle') return

      // Only session.created carries session info. Subagent sessions firing
      // idle is harmless: the counter only counts top-level sessions.
      if (event.type === 'session.created') {
        const props = 'properties' in event ? event.properties : undefined
        const info = props && typeof props === 'object' && 'info' in props ? props.info : undefined
        if (info && typeof info === 'object' && 'parentID' in info && info.parentID) {
          trace('skip: subagent session')
          return
        }
      }

      await nudgeIfDue(runner, event.type, (message) =>
        client.tui.showToast({ body: { title: 'Reflection available', message, variant: 'info', duration: 8000 } }),
      )
    },
  }
}

// The subset of the opencode 2 CLI plugin context this plugin uses.
type CliContext = {
  ui?: { toast: { show(input: { title?: string; message: string; variant?: string; duration?: number }): void } }
  data: { on(type: string, callback: () => void): () => void }
}

// opencode 1 calls `server`. opencode 2 calls `setup` twice: on the server
// (this file, discovered in plugins/) and in the CLI (via
// plugins/reflect-nudge-tui/tui.ts). Only the CLI context has `ui`, so the
// server instance stays inert and the toast comes from the CLI.
export default {
  id: 'reflect-nudge',
  server: ReflectNudgePlugin,
  async setup(ctx: CliContext) {
    if (!ctx.ui) return
    const runner = await findRunner()
    if (!runner) {
      trace('init: reflect not found on PATH and REFLECT_HOME unset — plugin inert')
      return
    }
    trace(`init: loaded (runner: ${runner.join(' ')}, opencode 2)`)
    const ui = ctx.ui
    // The v2 CLI does not receive session.idle; these three events mark every
    // way an agent turn ends, which is when v1 fires idle.
    const stops = ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].map(
      (type) =>
        ctx.data.on(type, () => {
          void nudgeIfDue(runner, type, (message) =>
            ui.toast.show({ title: 'Reflection available', message, variant: 'info', duration: 8000 }),
          )
        }),
    )
    return () => stops.forEach((stop) => stop())
  },
}

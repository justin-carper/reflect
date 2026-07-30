import type { Plugin } from '@opencode-ai/plugin'
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

export const ReflectNudgePlugin: Plugin = async ({ client, $ }) => {
  // Prefer `reflect` on PATH; fall back to a checkout pointed at by REFLECT_HOME.
  let runner: string[] | null = null
  try {
    await $`which reflect`.quiet()
    runner = ['reflect']
  } catch {
    const home = process.env.REFLECT_HOME
    const cli = home ? path.join(home, 'src/cli.mjs') : null
    if (cli && fs.existsSync(cli)) runner = ['node', cli]
  }

  if (!runner) {
    trace('init: reflect not found on PATH and REFLECT_HOME unset — plugin inert')
    return {}
  }
  trace(`init: loaded (runner: ${runner.join(' ')})`)

  return {
    event: async ({ event }) => {
      try {
        // session.created alone is not enough: resuming a session — the common
        // case — never fires it. session.idle fires in any session actually in
        // use, which is what makes the reminder reachable at all.
        if (event.type !== 'session.created' && event.type !== 'session.idle') return

        // Only session.created carries session info. Subagent sessions firing
        // idle is harmless: the counter only counts top-level sessions.
        if (event.type === 'session.created') {
          const info = (event as { properties?: { info?: { parentID?: string } } }).properties?.info
          if (info?.parentID) {
            trace('skip: subagent session')
            return
          }
        }

        const state = readState()
        const now = Date.now()

        if (state.lastCheckAt && now - state.lastCheckAt < CHECK_INTERVAL_MS) return
        writeState({ lastCheckAt: now })
        trace(`event: ${event.type} — running check`)

        if (state.lastNudgeAt && now - state.lastNudgeAt < COOLDOWN_MS) {
          trace(`skip: cooldown, last nudge ${Math.round((now - state.lastNudgeAt) / 1000)}s ago`)
          return
        }

        const result = await $`${runner} count --harness opencode`.quiet().nothrow()
        const raw = String(result.stdout).trim()
        const count = parseInt(raw, 10)
        trace(`count: raw="${raw}" parsed=${count} threshold=${THRESHOLD}`)
        if (!Number.isFinite(count) || count < THRESHOLD) {
          trace('skip: under threshold or unparseable')
          return
        }

        await client.tui.showToast({
          body: {
            title: 'Reflection available',
            message: `${count} sessions with corrective feedback since your last pass. Run /reflect.`,
            variant: 'info',
            duration: 8000,
          },
        })
        trace('toast: shown')

        writeState({ lastNudgeAt: now })
        trace('state: lastNudgeAt written')
      } catch (e) {
        trace(`error: ${(e as Error)?.message ?? String(e)}`)
      }
    },
  }
}

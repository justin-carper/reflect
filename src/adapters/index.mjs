import * as opencode from './opencode.mjs'
import * as claudeCode from './claude-code.mjs'
import * as pi from './pi.mjs'
import * as omp from './omp.mjs'

export const adapters = [opencode, claudeCode, pi, omp]

export function byName(name) {
  const a = adapters.find((x) => x.name === name)
  if (!a) {
    throw new Error(
      `unknown harness "${name}". available: ${adapters.map((x) => x.name).join(', ')}`,
    )
  }
  return a
}

export function detected() {
  return adapters.filter((a) => {
    try {
      return a.detect()
    } catch {
      return false
    }
  })
}

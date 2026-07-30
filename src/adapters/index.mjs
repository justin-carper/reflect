import * as opencode from './opencode.mjs'
import * as claudeCode from './claude-code.mjs'

export const adapters = [opencode, claudeCode]

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

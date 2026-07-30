// Corpus assembly: gate, dedupe, measure, emit.
//
// Everything here is harness-independent. Adapters hand over normalized
// sessions; this decides which are worth reading and writes the markdown an
// agent will analyze.

import { signalCounts } from './lexicon.mjs'
import { dropRepeats, dropNearDuplicateSessions } from './dedupe.mjs'

const MAX_MSG_CHARS = 700

export function build(sessions, { minSignal = 2, maxMessageChars = MAX_MSG_CHARS } = {}) {
  const scored = []
  for (const s of sessions) {
    const { messages, dropped } = dropRepeats(s.messages)
    const signal = signalCounts(messages)
    scored.push({ ...s, messages, signal, repeatsDropped: dropped })
  }

  const qualifying = scored.filter((s) => s.signal.corrective >= minSignal)
  const { sessions: kept, duplicatePairs } = dropNearDuplicateSessions(qualifying)
  kept.sort((a, b) => a.createdAt - b.createdAt)

  // Counted over the sessions that actually made it into the corpus, so the
  // number describes this corpus rather than everything that was scanned.
  const repeatsDropped = kept.reduce((n, s) => n + s.repeatsDropped, 0)

  const byRepo = new Map()
  for (const s of kept) byRepo.set(s.repo, (byRepo.get(s.repo) ?? 0) + 1)
  const repos = [...byRepo.entries()].sort((a, b) => b[1] - a[1])

  const byProject = new Map()
  for (const s of kept) byProject.set(s.project, (byProject.get(s.project) ?? 0) + 1)
  const projects = [...byProject.entries()].sort((a, b) => b[1] - a[1])

  const messageCount = kept.reduce((n, s) => n + s.messages.length, 0)
  const topShare = kept.length ? Math.round((100 * (repos[0]?.[1] ?? 0)) / kept.length) : 0

  return {
    sessions: kept,
    stats: {
      considered: scored.length,
      qualifying: kept.length,
      messages: messageCount,
      repeatsDropped,
      duplicateSessionsDropped: duplicatePairs.length,
      repos,
      projects,
      topShare,
      minSignal,
    },
    maxMessageChars,
  }
}

export function toMarkdown({ sessions, stats, maxMessageChars }, { since = 0, harnesses = [] } = {}) {
  const L = []
  L.push('# Reflection corpus')
  L.push('')
  L.push(`Generated: ${new Date().toISOString()}`)
  if (harnesses.length) L.push(`Harnesses: ${harnesses.join(', ')}`)
  L.push(
    `Window: ${since ? `sessions active after ${new Date(since).toISOString()}` : 'full history'}`,
  )
  L.push(
    `Sessions: ${stats.qualifying} qualifying (>= ${stats.minSignal} correction/friction messages) of ${stats.considered} top-level sessions in window`,
  )
  L.push(`Human messages: ${stats.messages}`)
  L.push(`Verbatim repeats dropped: ${stats.repeatsDropped}`)
  L.push(`Near-duplicate sessions dropped: ${stats.duplicateSessionsDropped}`)
  L.push('')
  L.push('## Project distribution')
  L.push('')
  L.push(
    'Concentration warning: a pattern appearing many times inside one repo is that repo\u2019s convention, not a universal preference. Weight a candidate rule by how many distinct repos support it, not how many sessions.',
  )
  L.push('')
  for (const [repo, n] of stats.repos) L.push(`- ${n} session(s) — ${repo}`)
  if (stats.repos.length) {
    L.push('')
    L.push(
      `Largest repo share: ${stats.topShare}% of the corpus (${stats.repos[0][1]} of ${stats.qualifying} sessions).`,
    )
  }
  L.push('')
  L.push('---')
  L.push('')

  for (const s of sessions) {
    L.push(`## Session ${s.id}`)
    L.push('')
    L.push(`- Date: ${new Date(s.createdAt).toISOString().slice(0, 10)}`)
    L.push(`- Harness: ${s.harness}`)
    L.push(`- Project: ${s.project}`)
    L.push(`- Title: ${s.title}`)
    L.push(
      `- Signal hits: ${s.signal.correction} correction, ${s.signal.friction} friction, ${s.signal.directive} directive`,
    )
    L.push('')
    s.messages.forEach((m, i) => {
      const t =
        m.text.length > maxMessageChars
          ? `${m.text.slice(0, maxMessageChars)} \u2026[truncated]`
          : m.text
      L.push(`[${i + 1}] ${t.replace(/\n{3,}/g, '\n\n')}`)
      L.push('')
    })
    L.push('---')
    L.push('')
  }

  return L.join('\n')
}

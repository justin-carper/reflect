// Deduplication.
//
// Both of these were discovered by running the tool and getting inflated
// numbers, not by design:
//
//  1. Clients resend on retry. A real corpus contained 227 verbatim repeat
//     messages, several sessions repeating an identical message 2-9 times.
//     Left in, they make a one-off instruction look like an emphatic pattern.
//
//  2. Forked or resumed sessions produce near-identical transcripts. Left in,
//     one conversation counts twice and its findings look corroborated.
//
// Removing both is what keeps "this appeared in N sessions" honest.

const REPEAT_KEY_CHARS = 400

// Drop verbatim repeats within a single session, keeping the first occurrence.
export function dropRepeats(messages) {
  const seen = new Set()
  const kept = []
  let dropped = 0
  for (const m of messages) {
    const key = m.text.slice(0, REPEAT_KEY_CHARS)
    if (seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    kept.push(m)
  }
  return { messages: kept, dropped }
}

function tokenSet(session) {
  return new Set(
    session.messages
      .map((m) => m.text.slice(0, 200))
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  )
}

function jaccard(a, b) {
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// Drop sessions that are near-identical to one already kept. Oldest wins, so
// the original survives and the fork is discarded.
export function dropNearDuplicateSessions(sessions, threshold = 0.9) {
  const ordered = [...sessions].sort((a, b) => a.createdAt - b.createdAt)
  const kept = []
  const pairs = []
  for (const s of ordered) {
    const tokens = tokenSet(s)
    let dup = null
    for (const k of kept) {
      if (jaccard(tokens, k._tokens) >= threshold) {
        dup = k
        break
      }
    }
    if (dup) {
      pairs.push([dup.id, s.id])
      continue
    }
    kept.push({ ...s, _tokens: tokens })
  }
  return { sessions: kept.map(({ _tokens, ...s }) => s), duplicatePairs: pairs }
}

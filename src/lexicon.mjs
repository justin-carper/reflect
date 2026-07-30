// Signal detection.
//
// These patterns are a cheap gate, never an extractor. They decide which
// sessions are worth an LLM's attention; they do not decide what the findings
// are. That distinction matters: across ~3000 real human messages, directive
// sentences were ~90% distinct from one another, so pattern matching finds
// almost no durable preference on its own. Reading whole sessions does.
//
// Tune by editing this file. Both the corpus builder and any nudge integration
// read the predicate from here, so they cannot drift apart.

export const LEXICON = {
  // "That was wrong, do it differently."
  correction:
    /\b(no,|nope|don'?t |do not |stop |not what|that'?s not|instead|actually|revert|undo|wrong|incorrect|mistake)/i,

  // "I already told you." Friction means a rule exists and did not bind —
  // the highest-value signal, because the fix is rewording, not adding.
  friction: /\b(you keep|again[,.]|i already (said|told)|as i said|like i said|still )/i,

  // "Always do X." Explicit durable preference.
  directive:
    /\b(always |never |prefer |from now on|going forward|i want you to|make sure|be sure to|you must|only )/i,

  // "That's right." Rarely present (~1% of messages) but it marks what to keep.
  praise: /\b(perfect|exactly|that'?s it|nice|good (job|call)|love it|great)/i,
}

// Only the opening of a message is scanned. Long messages are usually a short
// instruction followed by a pasted log or diff, and scanning the tail produces
// false positives from that pasted content.
const HEAD = 600

export function classify(text) {
  const head = text.slice(0, HEAD)
  const hits = {}
  for (const [name, re] of Object.entries(LEXICON)) hits[name] = re.test(head)
  return hits
}

// A session qualifies on corrective signal only. Directives and praise are
// recorded for the report but do not open the gate: a session full of "make
// sure to X" is usually a task briefing, not feedback about how you work.
export function signalCounts(messages) {
  let correction = 0
  let friction = 0
  let directive = 0
  let praise = 0
  // `corrective` counts MESSAGES, not pattern hits. A message matching both
  // correction and friction is one piece of feedback, not two — counting hits
  // instead inflates the gate and admits sessions that only look emphatic.
  let corrective = 0
  for (const m of messages) {
    const h = classify(m.text)
    if (h.correction) correction++
    if (h.friction) friction++
    if (h.directive) directive++
    if (h.praise) praise++
    if (h.correction || h.friction) corrective++
  }
  return { correction, friction, directive, praise, corrective }
}

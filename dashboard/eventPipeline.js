import fs from 'fs'
import path from 'path'

const ACTION_COALESCE_WINDOW_MS = 400
const DEDUPE_WINDOW_MS = 500
const MAX_EVENT_TEXT_CHARS = 700
const MAX_EVENT_RAW_CHARS = 1000

function stripAnsiForParse(str) {
  return (str || '')
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\([A-Z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\[(?:\?|>)[0-9;]*[a-zA-Z]/g, '')
}

function detectAgentKind(state, text) {
  const line = (text || '').toLowerCase()
  if (state?.agentKind && state.agentKind !== 'generic') return state.agentKind
  if (line.includes('claude code') || line.includes('/swarm ') || line.includes('/parallel ') || line.includes('bypass permissions')) return 'claude'
  if (line.includes('codex') || line.includes('openai codex')) return 'codex'
  return state?.agentKind || 'generic'
}

function classifyLine(line) {
  const t = line.trim()
  const lower = t.toLowerCase()

  if (!t) return { kind: 'system', level: 'info', text: '' }

  if (/usage.?limit|rate.?limit|too many requests|quota exceeded|credits?\s*(expired|ran\s*out|depleted)|hit your.{0,10}limit|try again at\b/i.test(lower)) {
    return { kind: 'error', level: 'error', text: t, subKind: 'rate_limit' }
  }

  if (/\berror\b|\bfailed\b|exception|traceback|fatal/.test(lower)) {
    return { kind: 'error', level: 'error', text: t }
  }
  if (/\bwarn\b|\bwarning\b|caution/.test(lower)) {
    return { kind: 'warning', level: 'warn', text: t }
  }
  if (/^\s*(step|progress|status)\s*[:\-]/i.test(t)) {
    return { kind: 'progress', level: 'info', text: t }
  }
  if (/tool|function call|running command|executing|bash\s+-|npm\s+|yarn\s+|pnpm\s+|git\s+/i.test(t)) {
    return { kind: 'tool', level: 'info', text: t }
  }
  if (/\b(file|path|src\/|\.tsx?\b|\.jsx?\b|\.md\b|\.json\b|\.css\b)\b/i.test(t)) {
    return { kind: 'file', level: 'info', text: t }
  }
  if (/^\s*(thinking|analysis|plan|reasoning)\b/i.test(lower)) {
    return { kind: 'thought', level: 'info', text: t }
  }

  return { kind: 'action', level: 'info', text: t }
}

function parseLines(lines, baseState, adapterKind) {
  const events = []
  let state = { ...baseState, agentKind: baseState?.agentKind || adapterKind }

  for (const line of lines) {
    const clean = line.trimEnd()
    if (!clean.trim()) continue
    state.agentKind = detectAgentKind(state, clean)
    const classified = classifyLine(clean)
    events.push({
      agentKind: state.agentKind || adapterKind,
      kind: classified.kind,
      level: classified.level,
      text: classified.text,
      raw: clean,
      meta: {
        parser: adapterKind,
        ...(classified.subKind ? { subKind: classified.subKind } : {}),
      },
    })
  }

  return { events, nextState: state }
}

function parseWithAdapter(chunk, state, adapterKind) {
  const normalized = stripAnsiForParse(chunk)
  const buffered = `${state?.leftover || ''}${normalized}`
  const parts = buffered.split('\n')
  const leftover = parts.pop() || ''
  const parsed = parseLines(parts, state, adapterKind)
  return {
    events: parsed.events,
    nextState: {
      ...parsed.nextState,
      leftover,
    },
  }
}

function clip(str, maxLen) {
  const s = String(str || '')
  if (s.length <= maxLen) return s
  const suffix = '...[truncated]'
  const keep = Math.max(0, maxLen - suffix.length)
  return `${s.slice(0, keep)}${suffix}`
}

function normalizeActionText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeRawText(text) {
  return String(text || '')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
}

function isLikelyActionNoise(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (/^[\u2500-\u257f\s]+$/.test(t)) return true
  if (/^\[\?\d+[hl]$/.test(t)) return true
  if (/^[^\w]{1,4}$/.test(t)) return true
  if (t.length <= 2 && !/[0-9]/.test(t)) return true
  return false
}

function shouldCoalesceAction(prevText, nextText) {
  if (!prevText || !nextText) return false
  const prevUser = /^USER>/.test(prevText)
  const nextUser = /^USER>/.test(nextText)
  if (prevUser !== nextUser) return false
  return true
}

function joinActionText(prev, next) {
  if (!prev) return next
  if (!next) return prev
  if (/[({[/]$/.test(prev)) return `${prev}${next}`
  if (/^[,.;:!?)}\]]/.test(next)) return `${prev}${next}`
  if (prev.endsWith(' ') || next.startsWith(' ')) return `${prev}${next}`
  return `${prev} ${next}`
}

export function parseChunkWithAdapters(chunk, state = {}) {
  const seededKind = state.agentKind && state.agentKind !== 'generic'
    ? state.agentKind
    : null
  const currentKind = seededKind || detectAgentKind(state, chunk)

  if (currentKind === 'claude') {
    const out = parseWithAdapter(chunk, state, 'claude')
    return { events: out.events, nextState: { ...out.nextState, agentKind: 'claude' } }
  }

  if (currentKind === 'codex') {
    const out = parseWithAdapter(chunk, state, 'codex')
    return { events: out.events, nextState: { ...out.nextState, agentKind: 'codex' } }
  }

  const out = parseWithAdapter(chunk, state, 'generic')
  return { events: out.events, nextState: { ...out.nextState, agentKind: currentKind || 'generic' } }
}

export function createSessionEventStore({ sessionId, repo, baseDir, ringSize = 1200 }) {
  const created = Date.now()
  const runtimeDir = path.join(baseDir, '.dispatch', 'runtime', 'events')
  try { fs.mkdirSync(runtimeDir, { recursive: true }) } catch { /* best effort — snapshot writes will also gracefully fail */ }
  const snapshotPath = path.join(runtimeDir, `${sessionId}.ndjson`)

  return {
    sessionId,
    repo,
    created,
    ringSize,
    nextId: 1,
    parserState: { agentKind: 'generic', leftover: '' },
    events: [],
    summary: {
      lastStep: null,
      lastError: null,
      lastErrorSubKind: null,
      errorCount: 0,
      filesTouched: [],
      toolCalls: 0,
    },
    lastPersisted: null,
    snapshotPath,
  }
}

export function appendChunkToEventStore(store, chunk) {
  const parsed = parseChunkWithAdapters(chunk, store.parserState)
  store.parserState = parsed.nextState

  const nowMs = Date.now()
  const added = []

  function persistEvent(evt, eventTsMs) {
    const clippedText = clip(evt.text || '', MAX_EVENT_TEXT_CHARS)
    const clippedRaw = clip(evt.raw || evt.text || '', MAX_EVENT_RAW_CHARS)
    if (!clippedText.trim()) return

    const last = store.lastPersisted
    if (
      last &&
      last.kind === (evt.kind || 'system') &&
      last.level === (evt.level || 'info') &&
      last.text === clippedText &&
      eventTsMs - last.tsMs <= DEDUPE_WINDOW_MS
    ) {
      return
    }

    const id = `${store.sessionId}:${store.nextId++}`
    const full = {
      id,
      sessionId: store.sessionId,
      repo: store.repo,
      ts: new Date(eventTsMs).toISOString(),
      agentKind: evt.agentKind || 'generic',
      kind: evt.kind || 'system',
      level: evt.level || 'info',
      text: clippedText,
      raw: clippedRaw,
      spanId: null,
      parentSpanId: null,
      meta: evt.meta || {},
    }

    store.events.push(full)
    added.push(full)
    store.lastPersisted = {
      tsMs: eventTsMs,
      kind: full.kind,
      level: full.level,
      text: full.text,
    }

    if (full.kind === 'progress' || /step|progress|status/i.test(full.text)) {
      store.summary.lastStep = full.text
    }
    if (full.level === 'error' || full.kind === 'error') {
      store.summary.lastError = full.text
      store.summary.lastErrorSubKind = full.meta?.subKind || null
      store.summary.errorCount = (store.summary.errorCount || 0) + 1
    }
    if (full.kind === 'tool') {
      store.summary.toolCalls += 1
    }

    const fileMatch = full.text.match(/([\w./-]+\.(?:js|jsx|ts|tsx|md|json|css|html|yml|yaml))/gi)
    if (fileMatch) {
      for (const f of fileMatch) {
        if (!store.summary.filesTouched.includes(f)) {
          store.summary.filesTouched.push(f)
        }
      }
      if (store.summary.filesTouched.length > 30) {
        store.summary.filesTouched = store.summary.filesTouched.slice(-30)
      }
    }
  }

  let pendingAction = null

  function flushPendingAction() {
    if (!pendingAction) return
    persistEvent({
      agentKind: pendingAction.agentKind,
      kind: 'action',
      level: 'info',
      text: pendingAction.text,
      raw: pendingAction.raw,
      meta: pendingAction.meta,
    }, pendingAction.tsMs)
    pendingAction = null
  }

  for (const evt of parsed.events) {
    const eventTsMs = nowMs
    const kind = evt.kind || 'system'
    if (kind !== 'action') {
      flushPendingAction()
      persistEvent({
        ...evt,
        text: String(evt.text || '').trim(),
        raw: String(evt.raw || evt.text || '').trim(),
      }, eventTsMs)
      continue
    }

    const text = normalizeActionText(evt.text)
    const raw = normalizeRawText(evt.raw || evt.text)
    if (!text || isLikelyActionNoise(text)) {
      continue
    }

    if (!pendingAction) {
      pendingAction = {
        agentKind: evt.agentKind || 'generic',
        text,
        raw,
        meta: evt.meta || {},
        tsMs: eventTsMs,
        lastTsMs: eventTsMs,
      }
      continue
    }

    const withinWindow = (eventTsMs - pendingAction.lastTsMs) <= ACTION_COALESCE_WINDOW_MS
    if (withinWindow && shouldCoalesceAction(pendingAction.text, text)) {
      pendingAction.text = joinActionText(pendingAction.text, text)
      pendingAction.raw = joinActionText(pendingAction.raw, raw)
      pendingAction.lastTsMs = eventTsMs
    } else {
      flushPendingAction()
      pendingAction = {
        agentKind: evt.agentKind || 'generic',
        text,
        raw,
        meta: evt.meta || {},
        tsMs: eventTsMs,
        lastTsMs: eventTsMs,
      }
    }
  }

  flushPendingAction()

  if (store.events.length > store.ringSize) {
    store.events = store.events.slice(-store.ringSize)
  }

  if (added.length > 0) {
    const lines = added.map(evt => JSON.stringify(evt)).join('\n') + '\n'
    try {
      fs.appendFileSync(store.snapshotPath, lines, 'utf8')
    } catch {
      // ignore snapshot append failures
    }
  }

  return added
}

export function getSessionEvents(store, { cursor = null, limit = 100, kinds = null } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 100))
  let rows = store.events

  if (cursor) {
    const [session, n] = String(cursor).split(':')
    const cursorNum = session === store.sessionId ? Number(n) : 0
    if (cursorNum > 0) {
      rows = rows.filter(evt => Number(evt.id.split(':')[1]) > cursorNum)
    }
  }

  if (kinds && kinds.size > 0) {
    rows = rows.filter(evt => kinds.has(evt.kind))
  }

  const page = rows.slice(-lim)
  const nextCursor = page.length > 0 ? page[page.length - 1].id : cursor

  return {
    items: page,
    nextCursor,
  }
}

export function searchEvents(stores, { q, scope = 'all', sessionId = null, repo = null, limit = 50 } = {}) {
  const query = (q || '').trim().toLowerCase()
  if (!query) return []

  const lim = Math.max(1, Math.min(200, Number(limit) || 50))
  const all = []

  for (const store of stores) {
    if (scope === 'session' && sessionId && store.sessionId !== sessionId) continue
    if (scope === 'repo' && repo && store.repo !== repo) continue
    all.push(...store.events)
  }

  return all
    .filter(evt => evt.text.toLowerCase().includes(query) || (evt.raw || '').toLowerCase().includes(query))
    .slice(-lim)
}

function summarizeEvents(events, limit = 20) {
  const take = events.slice(-limit)
  return take.map(evt => `[${evt.id}] (${evt.kind}/${evt.level}) ${evt.text}`).join('\n')
}

function heuristicAnswer(message, events) {
  const recent = events.slice(-80)
  if (recent.length === 0) {
    return {
      answer: 'Not enough evidence in session logs yet.',
      citations: [],
      usedEvents: 0,
    }
  }

  const q = (message || '').toLowerCase()
  let focus = recent
  if (q.includes('error') || q.includes('fail') || q.includes('blocked')) {
    focus = recent.filter(e => e.level === 'error' || e.kind === 'error' || /fail|error|blocked/i.test(e.text))
  } else if (q.includes('file') || q.includes('change')) {
    focus = recent.filter(e => e.kind === 'file' || /\.(tsx?|jsx?|md|json|css|html)\b/.test(e.text))
  } else if (q.includes('tool') || q.includes('command')) {
    focus = recent.filter(e => e.kind === 'tool')
  }
  if (focus.length === 0) focus = recent.slice(-12)

  const used = focus.slice(-8)
  const citations = used.map(e => ({ eventId: e.id }))

  const bullets = used.map(e => `- ${e.text}`).join('\n')
  return {
    answer: `Based on parsed logs, here is the best available evidence:\n${bullets}\n\nIf you need more certainty, ask for a narrower time window or specific event type.`,
    citations,
    usedEvents: used.length,
  }
}

async function callOpenAI({ apiKey, model, system, user }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}`)
  }

  const data = await res.json()
  return data?.choices?.[0]?.message?.content?.trim() || ''
}

async function callAnthropic({ apiKey, model, system, user }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: 500,
      temperature: 0.2,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}`)
  }

  const data = await res.json()
  const textBlocks = (data?.content || []).filter(c => c.type === 'text').map(c => c.text)
  return textBlocks.join('\n').trim()
}

export async function answerFromEvents({ message, events, provider = 'auto', model = null }) {
  const fallback = heuristicAnswer(message, events)
  if (!message || !message.trim()) return fallback

  const used = events.slice(-120)
  const context = summarizeEvents(used, 80)

  const system = 'You are a read-only monitoring analyst. Use only provided log events. If insufficient evidence, say so. Keep concise.'
  const user = `Question: ${message}\n\nEvents:\n${context}\n\nRespond with evidence-based answer only.`

  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  const choice = provider === 'auto'
    ? (openaiKey ? 'openai' : anthropicKey ? 'anthropic' : 'heuristic')
    : provider

  try {
    if (choice === 'openai' && openaiKey) {
      const text = await callOpenAI({ apiKey: openaiKey, model: model || 'gpt-4.1-mini', system, user })
      return {
        answer: text || fallback.answer,
        citations: fallback.citations,
        usedEvents: fallback.usedEvents,
      }
    }

    if (choice === 'anthropic' && anthropicKey) {
      const text = await callAnthropic({ apiKey: anthropicKey, model: model || 'claude-3-5-haiku-latest', system, user })
      return {
        answer: text || fallback.answer,
        citations: fallback.citations,
        usedEvents: fallback.usedEvents,
      }
    }
  } catch {
    return fallback
  }

  return fallback
}

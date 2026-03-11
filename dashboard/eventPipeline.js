import fs from 'fs'
import path from 'path'

function stripAnsiForParse(str) {
  return (str || '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\([A-Z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

function detectAgentKind(state, text) {
  const line = (text || '').toLowerCase()
  if (state?.agentKind && state.agentKind !== 'generic') return state.agentKind
  if (line.includes('claude code') || line.includes('/swarm ') || line.includes('bypass permissions')) return 'claude'
  if (line.includes('codex') || line.includes('openai codex')) return 'codex'
  return state?.agentKind || 'generic'
}

function classifyLine(line) {
  const t = line.trim()
  const lower = t.toLowerCase()

  if (!t) return { kind: 'system', level: 'info', text: '' }

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
  const runtimeDir = path.join(baseDir, '.hub-runtime', 'events')
  fs.mkdirSync(runtimeDir, { recursive: true })
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
      filesTouched: [],
      toolCalls: 0,
    },
    snapshotPath,
  }
}

export function appendChunkToEventStore(store, chunk) {
  const parsed = parseChunkWithAdapters(chunk, store.parserState)
  store.parserState = parsed.nextState

  const now = new Date().toISOString()
  const added = []

  for (const evt of parsed.events) {
    const id = `${store.sessionId}:${store.nextId++}`
    const full = {
      id,
      sessionId: store.sessionId,
      repo: store.repo,
      ts: now,
      agentKind: evt.agentKind || 'generic',
      kind: evt.kind || 'system',
      level: evt.level || 'info',
      text: evt.text || '',
      raw: evt.raw || evt.text || '',
      spanId: null,
      parentSpanId: null,
      meta: evt.meta || {},
    }

    store.events.push(full)
    added.push(full)

    if (full.kind === 'progress' || /step|progress|status/i.test(full.text)) {
      store.summary.lastStep = full.text
    }
    if (full.level === 'error' || full.kind === 'error') {
      store.summary.lastError = full.text
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

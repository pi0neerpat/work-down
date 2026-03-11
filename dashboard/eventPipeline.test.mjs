import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionEventStore, appendChunkToEventStore, parseChunkWithAdapters } from './eventPipeline.js'

test('parseChunkWithAdapters detects claude/codex/generic', () => {
  let st = { agentKind: 'generic', leftover: '' }
  let out = parseChunkWithAdapters('Claude Code ready\n', st)
  assert.equal(out.nextState.agentKind, 'claude')

  st = { agentKind: 'generic', leftover: '' }
  out = parseChunkWithAdapters('OpenAI Codex session started\n', st)
  assert.equal(out.nextState.agentKind, 'codex')

  st = { agentKind: 'generic', leftover: '' }
  out = parseChunkWithAdapters('hello world\n', st)
  assert.equal(out.nextState.agentKind, 'generic')
})

test('appendChunkToEventStore handles line buffering and summary', () => {
  const store = createSessionEventStore({ sessionId: 's1', repo: 'hub', baseDir: process.cwd(), ringSize: 50 })

  appendChunkToEventStore(store, 'Status: running')
  assert.equal(store.events.length, 0)

  appendChunkToEventStore(store, '\nERROR: failed to run\n')
  assert.equal(store.events.length, 2)
  assert.ok(store.summary.lastStep)
  assert.ok(store.summary.lastError)
})

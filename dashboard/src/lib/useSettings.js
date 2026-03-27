import { useState, useCallback } from 'react'

const STORAGE_KEY = 'hub-settings'

const DEFAULT_SETTINGS = {
  agents: {
    claude: { defaultModel: 'claude-opus-4-6', defaultMaxTurns: 10, skipPermissions: true, tuiMode: false, extraFlags: '' },
    codex:  { defaultModel: 'gpt-5.4',          defaultMaxTurns: null, skipPermissions: false, tuiMode: false, extraFlags: '' },
  },
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    // Merge with defaults so new keys are populated
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      agents: {
        ...DEFAULT_SETTINGS.agents,
        ...(parsed.agents || {}),
        claude: { ...DEFAULT_SETTINGS.agents.claude, ...(parsed.agents?.claude || {}) },
        codex:  { ...DEFAULT_SETTINGS.agents.codex,  ...(parsed.agents?.codex  || {}) },
      },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {}
}

export function useSettings() {
  const [settings, setSettings] = useState(() => loadSettings())

  const updateAgent = useCallback((agentId, patch) => {
    setSettings(prev => {
      const next = {
        ...prev,
        agents: {
          ...prev.agents,
          [agentId]: { ...prev.agents[agentId], ...patch },
        },
      }
      saveSettings(next)
      return next
    })
  }, [])

  return { settings, updateAgent }
}

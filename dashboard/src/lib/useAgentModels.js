import { useState, useEffect } from 'react'
import { MODEL_OPTIONS, CODEX_MODEL_OPTIONS, CURSOR_MODEL_OPTIONS } from './constants'

/**
 * Fetches available models for the given agent from the server, which queries
 * the Anthropic / OpenAI APIs. Falls back to hardcoded constants if the API
 * key isn't set or the request fails.
 */
export function useAgentModels(agent) {
  const fallback = agent === 'codex' ? CODEX_MODEL_OPTIONS
                 : agent === 'cursor' ? CURSOR_MODEL_OPTIONS
                 : MODEL_OPTIONS
  const [models, setModels] = useState(fallback)

  useEffect(() => {
    let cancelled = false
    setModels(fallback)
    fetch(`/api/agents/models?agent=${encodeURIComponent(agent)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data?.models?.length > 0) {
          setModels(data.models)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [agent, fallback])

  return models
}

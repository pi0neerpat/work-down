import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/**
 * Convert a date string or minutes into a human-friendly relative time.
 * Accepts either a date string ("2026-03-10") or a durationMinutes number.
 */
export function timeAgo(started, durationMinutes) {
  let mins = durationMinutes
  if (mins == null && started) {
    // Timestamps from job files are UTC but may lack a 'Z' suffix
    let normalized = String(started)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
      normalized = normalized.replace(' ', 'T')
      if (!normalized.endsWith('Z')) normalized += 'Z'
    }
    const d = new Date(normalized)
    if (!isNaN(d.getTime())) {
      mins = Math.round((Date.now() - d.getTime()) / 60000)
    }
  }
  if (mins == null) return ''
  if (mins < 0) return 'just now'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    const rem = mins % 60
    return rem > 0 ? `${hours}h ${rem}m ago` : `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}


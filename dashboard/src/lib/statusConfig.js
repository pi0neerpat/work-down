import { Activity, CheckCircle, XCircle, AlertCircle, Loader, Ban } from 'lucide-react'

/**
 * Status config for swarm agent states — icon, color, label, etc.
 * Used by RightPanel, ResultsPanel, SwarmDetail, Sidebar.
 */
export const statusConfig = {
  in_progress: {
    icon: Loader,
    color: 'text-status-active',
    borderColor: 'var(--status-active-border)',
    bg: 'bg-status-active-bg',
    label: 'Running',
    dotColor: 'var(--status-active)',
  },
  completed: {
    icon: CheckCircle,
    color: 'text-status-complete',
    borderColor: 'var(--status-complete-border)',
    bg: 'bg-status-complete-bg',
    label: 'Complete',
    dotColor: 'var(--status-complete)',
  },
  failed: {
    icon: XCircle,
    color: 'text-status-failed',
    borderColor: 'var(--status-failed-border)',
    bg: 'bg-status-failed-bg',
    label: 'Failed',
    dotColor: 'var(--status-failed)',
  },
  killed: {
    icon: Ban,
    color: 'text-status-failed',
    borderColor: 'var(--status-failed-border)',
    bg: 'bg-status-failed-bg',
    label: 'Killed',
    dotColor: 'var(--status-failed)',
  },
  needs_validation: {
    icon: AlertCircle,
    color: 'text-status-review',
    borderColor: 'var(--status-review-border)',
    bg: 'bg-status-review-bg',
    label: 'Review',
    dotColor: 'var(--status-review)',
  },
  unknown: {
    icon: Activity,
    color: 'text-muted-foreground',
    borderColor: 'var(--border)',
    bg: 'bg-muted',
    label: '?',
    dotColor: 'var(--muted-foreground)',
  },
}

/**
 * Validation config for swarm agent validation states.
 * Used by ResultsPanel, SwarmDetail.
 */
export const validationConfig = {
  needs_validation: {
    icon: AlertCircle,
    color: 'text-status-review',
    bg: 'bg-status-review-bg',
    border: 'border-status-review-border',
    label: 'Needs Review',
  },
  validated: {
    icon: CheckCircle,
    color: 'text-status-validated',
    bg: 'bg-status-validated-bg',
    border: 'border-status-active-border',
    label: 'Validated',
  },
  rejected: {
    icon: XCircle,
    color: 'text-status-failed',
    bg: 'bg-status-failed-bg',
    border: 'border-status-failed-border',
    label: 'Rejected',
  },
}

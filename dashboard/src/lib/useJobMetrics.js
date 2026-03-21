import { useMemo } from 'react'
import { buildWorkerNavItems } from './workerUtils'

export function useJobMetrics({ jobAgents, jobFileToSession, sessionRecordsForNav }) {
  const allJobs = useMemo(() => {
    return buildWorkerNavItems(
      jobAgents || [],
      null,
      jobFileToSession,
      sessionRecordsForNav
    )
  }, [jobAgents, jobFileToSession, sessionRecordsForNav])

  const activeJobCount = useMemo(() => {
    return allJobs.filter(w => w.status === 'in_progress' && !w.needsReview && w.alive !== false).length
  }, [allJobs])

  const reviewCount = useMemo(() => {
    return allJobs.filter(w => w.needsReview || w.validation === 'needs_validation').length
  }, [allJobs])

  return { allJobs, activeJobCount, reviewCount }
}

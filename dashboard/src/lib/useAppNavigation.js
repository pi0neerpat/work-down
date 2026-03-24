import { useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const NAV_ITEMS = ['status', 'jobs', 'tasks', 'dispatch', 'schedules']

/** Derive the activeNav tab from the current URL pathname. */
export function navFromPath(pathname) {
  const seg = pathname.split('/').filter(Boolean)[0] || ''
  if (NAV_ITEMS.includes(seg)) return seg
  return 'tasks' // fallback
}

export function useAppNavigation() {
  const navigate = useNavigate()
  const location = useLocation()

  const activeNav = navFromPath(location.pathname)

  // drillDownJobId is derived from URL: /jobs/:jobId
  const segments = location.pathname.split('/').filter(Boolean)
  const drillDownJobId = segments[0] === 'jobs' && segments[1]
    ? decodeURIComponent(segments[1])
    : null

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const setActiveNav = useCallback((nav) => {
    if (NAV_ITEMS.includes(nav)) {
      navigate(`/${nav}`)
    }
  }, [navigate])

  const handleNavChange = useCallback((nav) => {
    if (NAV_ITEMS.includes(nav)) {
      navigate(`/${nav}`)
    }
  }, [navigate])

  const openJobDetail = useCallback((id) => {
    navigate(`/jobs/${encodeURIComponent(id)}`)
  }, [navigate])

  const openDispatch = useCallback(() => {
    navigate('/dispatch')
  }, [navigate])

  const closeJobDetail = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const setDrillDownJobId = useCallback((id) => {
    if (id) {
      navigate(`/jobs/${encodeURIComponent(id)}`)
    } else {
      navigate('/jobs')
    }
  }, [navigate])

  return {
    activeNav,
    setActiveNav,
    drillDownJobId,
    setDrillDownJobId,
    commandPaletteOpen,
    setCommandPaletteOpen,
    handleNavChange,
    openJobDetail,
    openDispatch,
    closeJobDetail,
  }
}

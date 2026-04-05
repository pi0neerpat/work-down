/**
 * When the hub uses DISPATCH_API_KEY, production builds must set
 * VITE_DISPATCH_API_KEY to the same value so browser fetch() includes X-API-Key.
 * Dev: Vite proxy injects the key from DISPATCH_API_KEY (see vite.config.js).
 */
const key = import.meta.env.VITE_DISPATCH_API_KEY
if (key && typeof window !== 'undefined') {
  const orig = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const next = { ...init }
    const h = new Headers(init.headers || {})
    h.set('X-API-Key', key)
    next.headers = h
    return orig(input, next)
  }
}

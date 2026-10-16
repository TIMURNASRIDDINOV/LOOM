import { API_BASE } from './client'

let reports = 0
export function reportRenderError(error: Error) {
  if (reports >= 3) return
  reports++
  const stack = (error.stack?.match(/:\d{1,7}:\d{1,7}(?=\)|\s|$)/g) || []).slice(0, 12).join(' ')
  fetch(`${API_BASE}/api/files/client-error`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'render', surface: 'app', stack }),
  }).catch(() => {})
}

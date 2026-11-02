import { useEffect, useState } from 'react'
import { api } from '../api/client'

// The app's LOOM Lab flag (PRD-210 A-4): `GET /api/lab/status` → `enabled`.
// Anything but `{ enabled: true }` — a 404 while the endpoint does not exist,
// offline, an error, no answer within 5 s — means off, silently: no toast.
// Every Lab entry (Home, Studio, Account, /lab) hides while it is off.

const TIMEOUT_MS = 5000

let pending: Promise<boolean> | null = null

// ponytail: one answer per launch — a flag flipped on the server shows on the
// next launch. The server still refuses Lab calls itself (`lab_disabled`).
export function fetchLabEnabled(): Promise<boolean> {
  if (pending) return pending
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  pending = api<{ enabled?: unknown }>('/api/lab/status', { auth: true, signal: ctrl.signal })
    .then((r) => r?.enabled === true)
    .catch(() => false)
    .finally(() => clearTimeout(timer))
  return pending
}

/** False until the server says the Lab is on. `EXPO_PUBLIC_LAB=1` forces it on in dev builds only. */
export function useLabEnabled(): boolean {
  const forced = __DEV__ && process.env.EXPO_PUBLIC_LAB === '1'
  const [on, setOn] = useState(forced)
  useEffect(() => {
    if (forced) return
    let live = true
    fetchLabEnabled().then((v) => live && setOn(v))
    return () => {
      live = false
    }
  }, [forced])
  return on
}

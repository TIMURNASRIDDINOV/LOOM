import { Platform } from 'react-native'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_BASE } from './client'

const EVENTS = ['cfg_open', 'cfg_design_add', 'cfg_style', 'cfg_preview_3d', 'cfg_cart', 'cfg_checkout_submit', 'cfg_order'] as const
export type FunnelEvent = typeof EVENTS[number]
const SESSION_KEY = 'loom_session_id'
const ACTIVITY_KEY = 'loom_session_last_active'
const EVENTS_KEY = 'loom_session_events'
const IDLE_MS = 30 * 60 * 1000
let sessionId: string | null = null
let lastActive = 0, hydrated = false
let sessionWork: Promise<void> = Promise.resolve()
const seen = new Set<FunnelEvent>()

function persistEvents(id: string) {
  if (id === sessionId) AsyncStorage.setItem(EVENTS_KEY, JSON.stringify({ id, events: [...seen] })).catch(() => {})
}

async function resolveSession(): Promise<string> {
  if (!hydrated) {
    hydrated = true
    try {
      const [id, activity, events] = await Promise.all([AsyncStorage.getItem(SESSION_KEY), AsyncStorage.getItem(ACTIVITY_KEY), AsyncStorage.getItem(EVENTS_KEY)])
      sessionId = id
      lastActive = Number(activity) || 0
      const stored = JSON.parse(events || 'null') as { id?: string; events?: unknown[] } | null
      if (stored?.id === id && Array.isArray(stored.events)) {
        for (const event of EVENTS) if (stored.events.includes(event)) seen.add(event)
      }
    } catch { /* Storage unavailable: keep the session in memory. */ }
  }
  const now = Date.now()
  if (!sessionId || !lastActive || now - lastActive >= IDLE_MS || now < lastActive) {
    sessionId = `app_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    seen.clear()
    persistEvents(sessionId)
  }
  lastActive = now
  const id = sessionId
  await Promise.all([AsyncStorage.setItem(SESSION_KEY, id), AsyncStorage.setItem(ACTIVITY_KEY, String(now))]).catch(() => {})
  return id
}

function session(): Promise<string> {
  const next = sessionWork.then(resolveSession)
  sessionWork = next.then(() => {}, () => {})
  return next
}

/** Checkout and client events share the same idle-expiring session. */
export async function checkoutSessionId(): Promise<string> { return session() }

/** Deduplicate within the resolved session, after checking its idle timeout. */
export function track(event: FunnelEvent, page = '/studio'): void {
  session().then(async (id) => {
    if (seen.has(event)) return
    seen.add(event)
    persistEvents(id)
    try {
      const response = await fetch(`${API_BASE}/api/files/track`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: id, page, device_type: 'app', os: Platform.OS,
          browser: `loom-app ${Constants.expoConfig?.version ?? ''}`.trim(), referrer: null, event }),
      })
      if (!response.ok) throw new Error('Tracking refused')
    } catch {
      if (id === sessionId) { seen.delete(event); persistEvents(id) }
    }
  }).catch(() => {})
}

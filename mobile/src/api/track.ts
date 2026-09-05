import { Platform } from 'react-native'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_BASE } from './client'

// Funnel analytics, mirroring the storefront (assets/track.js): the same
// allow-listed events land in `page_visits`, so the admin dashboard's
// configurator funnel counts app sessions next to web sessions.
//
// Fire-and-forget: analytics must never slow a tap or surface an error.

export type FunnelEvent =
  | 'cfg_open'
  | 'cfg_design_add'
  | 'cfg_style'
  | 'cfg_preview_3d'
  | 'cfg_cart'
  | 'cfg_order'

const SESSION_KEY = 'loom_session_id'
let sessionId: string | null = null
const seen = new Set<FunnelEvent>()

async function session(): Promise<string> {
  if (sessionId) return sessionId
  try {
    const stored = await AsyncStorage.getItem(SESSION_KEY)
    if (stored) return (sessionId = stored)
  } catch {
    // fall through to a fresh id
  }
  sessionId = `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  AsyncStorage.setItem(SESSION_KEY, sessionId).catch(() => {})
  return sessionId
}

/** Record a funnel event once per app session. */
export function track(event: FunnelEvent, page = '/studio'): void {
  if (seen.has(event)) return
  seen.add(event)
  session()
    .then((id) =>
      fetch(`${API_BASE}/api/files/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: id,
          page,
          device_type: 'app',
          os: Platform.OS,
          browser: `loom-app ${Constants.expoConfig?.version ?? ''}`.trim(),
          referrer: null,
          event,
        }),
      }),
    )
    .catch(() => {})
}

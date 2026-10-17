import AsyncStorage from '@react-native-async-storage/async-storage'

type Attempt = { key: string; fingerprint: string; synced: boolean }
const STORE = 'loom_checkout_attempt_v1'
let active: Attempt | null = null

/** Keep the attempt across network retries and app restarts. */
export async function checkoutAttempt(fingerprint: string): Promise<Attempt> {
  if (active?.fingerprint === fingerprint) return active
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(STORE) || 'null') as Attempt | null
    if (saved?.fingerprint === fingerprint && typeof saved.key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(saved.key) && typeof saved.synced === 'boolean') {
      active = saved
      return saved
    }
  } catch { /* A corrupt entry starts a new attempt. */ }
  const key = globalThis.crypto?.randomUUID?.() ?? `checkout_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
  active = { key, fingerprint, synced: false }
  await AsyncStorage.setItem(STORE, JSON.stringify(active))
  return active
}

export async function markCheckoutSynced(attempt: Attempt): Promise<void> {
  attempt.synced = true
  await AsyncStorage.setItem(STORE, JSON.stringify(attempt))
}

export async function clearCheckoutAttempt(key: string): Promise<void> {
  if (active?.key !== key) return
  active = null
  await AsyncStorage.removeItem(STORE).catch(() => {})
}

import { api, ApiError, getToken } from './client'
import type { StringKey } from '../i18n/strings'

export const LAB_STYLES = ['minimal', 'uzbek', 'street', 'retro', '3d'] as const
export type LabStyle = typeof LAB_STYLES[number]
export type LabStatus = { enabled: boolean; signedIn: boolean; remaining: number | null }
export type LabVariant = { url: string; uploadKey: string; width: number; height: number; lowQuality: boolean }
export type LabRun = { runId: string; createdAt: number; prompt: string; style: LabStyle; variants: [LabVariant] }
export type LabResult = LabRun & { remaining: number }
export type LabHistory = { runs: LabRun[]; page: number; hasMore: boolean }
export type LabProblem = 'limit' | 'refused' | 'later' | 'failed' | 'offline' | 'login' | 'disabled' | 'invalid'

// Map stable Lab codes here: the shared client and other screen groups keep
// their existing behavior. Never display the server's English error text.
export function labProblem(error: unknown): LabProblem {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.code === 'sign_in_required') return 'login'
    if (error.code === 'lab_disabled') return 'disabled'
    if (error.code === 'lab_limit_reached') return 'limit'
    if (error.code === 'prompt_refused') return 'refused'
    if (error.code === 'lab_global_cap') return 'later'
    if (error.status === 0) return 'offline'
    if (error.code === 'invalid_request') return 'invalid'
  }
  return 'failed'
}

export function labMessage(error: unknown): StringKey {
  const problem = labProblem(error)
  if (problem === 'offline') return 'common.offline'
  if (problem === 'login') return 'lab.signIn'
  if (problem === 'invalid') return 'lab.invalid'
  return 'lab.reportFailed'
}

const fixtureMode = __DEV__ && process.env.EXPO_PUBLIC_LAB_FIXTURE
let fixture: Promise<import('../components/lab/fixture').LabFixture> | undefined
async function devFixture() {
  // Only entered when the dev-only fixture override is enabled.
  if (!fixture) fixture = import('../components/lab/fixture').then((m) => m.createLabFixture(String(fixtureMode)))
  return fixture
}

export async function getLabStatus(signedIn: boolean, signal?: AbortSignal): Promise<LabStatus> {
  if (fixtureMode) return (await devFixture()).status(signedIn)
  return api<LabStatus>('/api/lab/status', { auth: true, signal })
}

export async function generateLab(prompt: string, style: LabStyle, signal: AbortSignal): Promise<LabResult> {
  if (fixtureMode) return (await devFixture()).generate(prompt, style, signal)
  const ctrl = new AbortController()
  const abort = () => ctrl.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) ctrl.abort()
  // The server may take 60 seconds; the client must wait longer than that.
  const timer = setTimeout(abort, 90000)
  try {
    return await api<LabResult>('/api/lab/generate', { method: 'POST', body: { prompt: prompt.trim(), style }, auth: true, signal: ctrl.signal })
  } catch (error) {
    if (ctrl.signal.aborted && !signal.aborted) throw new ApiError('', 504, 'timeout')
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export async function getLabHistory(page = 1, signal?: AbortSignal): Promise<LabHistory> {
  if (fixtureMode) return (await devFixture()).history(page)
  return api<LabHistory>(`/api/lab/history?page=${page}`, { auth: true, signal })
}

export async function reportLab(runId: string): Promise<void> {
  if (fixtureMode) return (await devFixture()).report(runId)
  await api('/api/lab/report', { method: 'POST', body: { runId, variant: 0 }, auth: true })
}

/** Private PNGs need Bearer auth. A data URI also lets the existing studio
 * render them on native and web without changing its image loaders. */
export async function loadLabImage(url: string, signal: AbortSignal): Promise<string> {
  if (url.startsWith('data:image/')) return url
  const token = await getToken()
  const res = await fetch(url, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError('', res.status)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => { reader.abort(); reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })) }
    signal.addEventListener('abort', abort, { once: true })
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.onloadend = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) abort()
    else reader.readAsDataURL(blob)
  })
}

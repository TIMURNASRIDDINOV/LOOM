import { ApiError } from '../../api/client'
import type { LabHistory, LabResult, LabRun, LabStatus, LabStyle } from '../../api/lab'
import imageUri from './fixture-image'

// Dev only: EXPO_PUBLIC_LAB=1 EXPO_PUBLIC_LAB_FIXTURE=success npx expo start --web
// Other scenarios: empty, offline, report_failed, low_quality, lab_limit_reached,
// lab_global_cap, prompt_refused, generation_failed, cutout_failed, timeout, 502.
// Sign-in still uses the normal auth flow; this fixture never authenticates a user.
export function createLabFixture(scenario: string) {
  let remaining = scenario === 'lab_limit_reached' ? 0 : 3
  let counter = 0
  const runs: LabRun[] = []
  const failure = () => new ApiError('', scenario === 'offline' ? 0 : scenario === '502' ? 502 : 429, scenario)
  const makeRun = (prompt: string, style: LabStyle): LabRun => ({
    runId: `lab-fixture-${++counter}`, createdAt: Date.now(), prompt, style,
    variants: [{ url: imageUri, uploadKey: `lab-fixture/${counter}.png`, width: 1024, height: 1024, lowQuality: scenario === 'low_quality' }],
  })
  return {
    async status(signedIn: boolean): Promise<LabStatus> {
      if (scenario === 'offline') throw failure()
      return { enabled: true, signedIn, remaining: signedIn ? remaining : null }
    },
    async generate(prompt: string, style: LabStyle, signal: AbortSignal): Promise<LabResult> {
      // Cancelling stops the caller waiting; a successful server run still
      // spends a credit and remains in history (the documented API contract).
      const job = new Promise<LabResult>((resolve, reject) => setTimeout(() => {
        if (['lab_global_cap', 'prompt_refused', 'generation_failed', 'cutout_failed', 'timeout', '502', 'offline'].includes(scenario)) return reject(failure())
        if (!remaining) return reject(new ApiError('', 429, 'lab_limit_reached', { remaining: 0 }))
        const run = makeRun(prompt.trim(), style)
        remaining--
        runs.unshift(run)
        resolve({ ...run, remaining })
      }, 1400))
      return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        job.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
    },
    async history(page: number): Promise<LabHistory> {
      if (scenario === 'offline') throw failure()
      return { runs: runs.slice((page - 1) * 20, page * 20), page, hasMore: runs.length > page * 20 }
    },
    async report(_runId: string): Promise<void> {
      if (scenario === 'report_failed') throw new ApiError('', 502)
    },
  }
}
export type LabFixture = ReturnType<typeof createLabFixture>

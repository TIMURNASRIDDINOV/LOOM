import { generateLab, type LabStyle } from '../../api/lab'

/** One server run at a time. Cancel hides its result without aborting the
 * request, so a second run cannot start before settlement (or API timeout). */
export function createLabGeneration() {
  let current: { ignored: boolean; result: ReturnType<typeof generateLab> } | null = null
  return {
    get busy() { return current !== null },
    cancel() { if (current) current.ignored = true },
    start(prompt: string, style: LabStyle) {
      if (current) return null
      const run = { ignored: false, result: generateLab(prompt, style, new AbortController().signal) }
      current = run
      run.result = run.result.finally(() => { if (current === run) current = null })
      return run
    },
  }
}

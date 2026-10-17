// Keep diagnostics structural: exception messages may contain user input.
// Never log bodies, headers, query strings, or the first (message) stack line.
export function stackLocations(stack: unknown): string[] {
  if (typeof stack !== 'string') return []
  return [...stack.matchAll(/:(\d{1,7}):(\d{1,7})(?:\)|\s|$)/g)].slice(0, 12)
    .map((match) => `at ${match[1]}:${match[2]}`)
}
export function errorLog(kind: string, stack: unknown, method: string, path: string, ray: string | undefined) {
  const cfRay = ray && /^[a-f0-9]{8,32}(?:-[A-Z]{3})?$/i.test(ray) ? ray : null
  console.error(JSON.stringify({ level: 'error', msg: kind, stack: stackLocations(stack), method, path, 'cf-ray': cfRay }))
}

// Checkout waits for the exact files referenced by the cart. The review GLB
// remains optional and may arrive after checkout (LOOM-206).
const fields = ['logo_key', 'back_logo_key', 'front_print_key', 'back_print_key', 'front_mockup_key', 'back_mockup_key'] as const
type FileItem = { design_json: string } & Partial<Record<typeof fields[number], string | null>>
export function orderFileKeys(item: FileItem): string[] {
  const keys = new Set<string>()
  const add = (v: unknown) => { if (typeof v === 'string' && v) keys.add(v) }
  for (const field of fields) add(item[field])
  try {
    const d = JSON.parse(item.design_json)
    for (const face of [d.front, d.back]) {
      if (!face) continue
      add(face.logoKey); add(face.originalKey)
      for (const el of face.elements || []) { add(el.key); add(el.originalKey) }
    }
  } catch { /* existing design validation owns malformed data */ }
  return [...keys]
}
export async function filesReady(bucket: R2Bucket, items: Parameters<typeof orderFileKeys>[0][]): Promise<boolean> {
  const keys = [...new Set(items.flatMap(orderFileKeys))]
  // Only deferred keys need the gate; legacy/marketplace file behavior stays intact.
  const pending = keys.filter(k => k.startsWith('pending/'))
  return (await Promise.all(pending.map(k => bucket.head(k)))).every(Boolean)
}

/** Image references travel inside design_json, including every layer on both faces. */
export function designAssetKeys(json: unknown): string[] {
  let design: Record<string, unknown>
  try { design = typeof json === 'string' ? JSON.parse(json) : json } catch { return [] }
  if (!design || typeof design !== 'object') return []
  const keys = new Set<string>()
  for (const side of ['front', 'back']) {
    const view = design[side] as Record<string, unknown> | null
    if (!view || typeof view !== 'object') continue
    const layers = [view, ...(Array.isArray(view.elements) ? view.elements : [])]
    for (const layer of layers) if (layer && typeof layer === 'object') {
      for (const field of ['key', 'originalKey', 'artworkKey']) {
        const value = (layer as Record<string, unknown>)[field]
        if (typeof value === 'string' && value) keys.add(value)
      }
    }
  }
  return [...keys]
}

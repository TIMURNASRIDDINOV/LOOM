export const ARTWORK_ERRORS = {
  artwork_title: 'Название должно содержать от 1 до 80 символов.',
  artwork_markup: 'Наценка — целое число от 0 до 200 000 сум.',
  artwork_tags: 'Теги — не более 200 символов.',
  artwork_category: 'Выберите действующую категорию.',
} as const

// Shared by submission and admin editing: never clamp invalid money silently.
export function artworkDetails(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 80) return { error: 'artwork_title' } as const
  if (!Number.isInteger(body.markup) || (body.markup as number) < 0 || (body.markup as number) > 200000) {
    return { error: 'artwork_markup' } as const
  }
  if (body.tags != null && typeof body.tags !== 'string') return { error: 'artwork_tags' } as const
  const tags = typeof body.tags === 'string' ? body.tags.trim() : ''
  if (tags.length > 200) return { error: 'artwork_tags' } as const
  if (!Number.isSafeInteger(body.category_id) || (body.category_id as number) <= 0) {
    return { error: 'artwork_category' } as const
  }
  return { value: { title, tags: tags || null, markup: body.markup as number, category_id: body.category_id as number } }
}

export function categoryDetails(body: Record<string, unknown>) {
  const names = ['name_ru', 'name_uz', 'name_en'] as const
  const value = { name_ru: '', name_uz: '', name_en: '', active: body.active === false ? 0 : 1 }
  if (body.active !== undefined && typeof body.active !== 'boolean') return null
  for (const key of names) {
    const name = body[key]
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) return null
    value[key] = name.trim()
  }
  return value
}

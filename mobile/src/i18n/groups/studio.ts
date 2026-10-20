import type { Group } from '../strings'

// Studio group (LOOM-249): the design and size steps and their tool sheets.
// Add every key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {}

export const studio: Group<typeof ru> = { ru, uz: {}, en: {} }

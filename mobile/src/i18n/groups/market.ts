import type { Group } from '../strings'

// Market group (LOOM-252): market, designer profile and the publish flow. Add
// every key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {}

export const market: Group<typeof ru> = { ru, uz: {}, en: {} }

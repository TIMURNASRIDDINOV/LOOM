import type { Group } from '../strings'

// Shop group (LOOM-248): home, catalog, product, cart and checkout. Add every
// key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {}

export const shop: Group<typeof ru> = { ru, uz: {}, en: {} }

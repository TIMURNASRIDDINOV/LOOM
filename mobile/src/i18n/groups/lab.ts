import type { Group } from '../strings'

// Lab group (LOOM-250): LOOM Lab prompt, results, history and their states.
// Add every key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {}

export const lab: Group<typeof ru> = { ru, uz: {}, en: {} }

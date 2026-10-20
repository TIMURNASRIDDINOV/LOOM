import type { Group } from '../strings'

// Account group (LOOM-251): orders, order detail, account and profile. Add
// every key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {}

export const account: Group<typeof ru> = { ru, uz: {}, en: {} }

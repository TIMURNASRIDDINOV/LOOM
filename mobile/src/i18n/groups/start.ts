import type { Group } from '../strings'

// Start group (LOOM-247): language, onboarding and sign-in screens. Add every
// key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {}

export const start: Group<typeof ru> = { ru, uz: {}, en: {} }

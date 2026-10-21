import type { Group } from '../strings'

// Start group (LOOM-247): language, onboarding and sign-in screens. Add every
// key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {
  'onb.langEyebrow': '01 / Язык',
  'onb.tagText': 'Текст',
  'onb.tagGraphic': 'Графика',
  'onb.tagColor': 'Цвет одежды',
  'onb.printSize': 'печать 30×40 см · спереди',
  'login.apple': 'Продолжить через Apple',
  'login.emailLabel': 'Email',
  'login.expiredTitle': 'Время вышло',
  'login.errBot': 'Не удалось открыть Telegram. Нажмите «Открыть Telegram бот».',
}

export const start: Group<typeof ru> = {
  ru,
  uz: {
    'onb.langEyebrow': '01 / Til',
    'onb.tagText': 'Matn',
    'onb.tagGraphic': 'Grafika',
    'onb.tagColor': 'Kiyim rangi',
    'onb.printSize': 'chop 30×40 sm · old',
    'login.apple': 'Apple orqali davom etish',
    'login.emailLabel': 'Email',
    'login.expiredTitle': 'Vaqt tugadi',
    'login.errBot': 'Telegram ochilmadi. «Telegram botni ochish» tugmasini bosing.',
  },
  en: {
    'onb.langEyebrow': '01 / Language',
    'onb.tagText': 'Text',
    'onb.tagGraphic': 'Graphic',
    'onb.tagColor': 'Garment colour',
    'onb.printSize': 'print 30×40 cm · front',
    'login.apple': 'Continue with Apple',
    'login.emailLabel': 'Email',
    'login.expiredTitle': 'Time ran out',
    'login.errBot': 'Couldn’t open Telegram. Tap “Open the Telegram bot”.',
  },
}

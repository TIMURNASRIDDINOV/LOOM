import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getLocales } from 'expo-localization'

import { en, ru, uz, type Dictionary, type StringKey } from './strings'

// Interface language. Russian, Uzbek and English, like the storefront
// (assets/i18n.js). The choice persists on the device; the first launch
// follows the phone's language, falling back to Russian.

export type Lang = 'ru' | 'uz' | 'en'
export const LANGS: { id: Lang; short: string; label: string }[] = [
  { id: 'ru', short: 'RU', label: 'Русский' },
  { id: 'uz', short: 'UZ', label: 'O‘zbekcha' },
  { id: 'en', short: 'EN', label: 'English' },
]

const DICT: Record<Lang, Dictionary> = { ru, uz, en }
const STORE_KEY = 'loom_lang'

export type TFn = (key: StringKey, vars?: Record<string, string | number>) => string

type I18n = { lang: Lang; setLang: (l: Lang) => void; t: TFn }

const Ctx = createContext<I18n | null>(null)

function fromDevice(): Lang {
  try {
    const code = (getLocales()[0]?.languageCode ?? '').toLowerCase()
    if (code === 'uz') return 'uz'
    if (code === 'en') return 'en'
  } catch {
    // no locale info — Russian is the market default
  }
  return 'ru'
}

function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** Translate outside React (toasts from async code, plain modules). */
let current: Lang = 'ru'
export function tStatic(key: StringKey, vars?: Record<string, string | number>): string {
  return format(DICT[current][key] ?? ru[key] ?? key, vars)
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(fromDevice())

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((v) => {
        if (v === 'ru' || v === 'uz' || v === 'en') {
          current = v
          setLangState(v)
        }
      })
      .catch(() => {})
  }, [])

  const setLang = useCallback((l: Lang) => {
    current = l
    setLangState(l)
    AsyncStorage.setItem(STORE_KEY, l).catch(() => {})
  }, [])

  const t = useCallback<TFn>((key, vars) => format(DICT[lang][key] ?? ru[key] ?? key, vars), [lang])

  current = lang
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>')
  return v
}

/** The common case: just the translate function. */
export function useT(): TFn {
  return useI18n().t
}

// ─── Domain helpers ──────────────────────────────────────────────────────────

const COLOR_KEYS: Record<string, StringKey> = {
  '#FFFFFF': 'color.white',
  '#1C1C1C': 'color.black',
  '#E2D9CC': 'color.sand',
  '#9BA3AF': 'color.grey',
  '#2B3E5E': 'color.navy',
  '#4D6642': 'color.khaki',
}

/** Garment colour name for a hex, in the current language. */
export function colorName(hex: string, t: TFn): string {
  const key = COLOR_KEYS[hex.toUpperCase()]
  return key ? t(key) : hex
}

export function statusLabel(status: string, t: TFn): string {
  const key = `status.${status}` as StringKey
  return (ru as Record<string, string>)[key] ? t(key) : status
}

/** `5 сен` / `5 sen` / `5 Sep` from a unix-seconds timestamp. */
export function shortDate(tsSeconds: number, t: TFn): string {
  const d = new Date(tsSeconds * 1000)
  const months = t('months').split(',')
  return `${d.getDate()} ${months[d.getMonth()] ?? ''}`
}

/** Product name in the interface language — `name_en` when it exists, else Russian. */
export function productName(p: { name_ru: string; name_en?: string | null }, lang: Lang): string {
  return lang === 'en' && p.name_en ? p.name_en : p.name_ru
}

import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { C, RULE } from '../src/theme/tokens'
import { body, disp, monoSemi } from '../src/theme/type'
import { LanguageChoice } from '../src/components/start/LanguageChoice'
import { ArtDelivery, ArtPreview, ArtStudio } from '../src/components/start/OnboardArt'
import { Button, T, Tap, Wordmark } from '../src/components/ui'
import { useI18n } from '../src/i18n'
import type { StringKey } from '../src/i18n/strings'

export const ONBOARD_KEY = 'loom_onboarded_v1'
// Written by I18nProvider.setLang; its absence means the user never chose.
const LANG_KEY = 'loom_lang'

const SLIDES: { title: StringKey; body: StringKey; art: () => React.ReactElement }[] = [
  { title: 'onb.1.title', body: 'onb.1.body', art: ArtStudio },
  { title: 'onb.2.title', body: 'onb.2.body', art: ArtPreview },
  { title: 'onb.3.title', body: 'onb.3.body', art: ArtDelivery },
]

/** Steps: the language choice (W02) comes first, then slides 0–2 (W03–W05). */
const LANGUAGE = -1

export default function Onboarding() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { t, lang, setLang } = useI18n()
  const [step, setStep] = useState<number | null>(null)

  // First launch asks for the language; a returning visitor who already chose
  // one (Account → Til) goes straight to the slides.
  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then(
      (v) => setStep(v ? 0 : LANGUAGE),
      () => setStep(LANGUAGE),
    )
  }, [])

  const finish = async (target: '/login' | '/') => {
    await AsyncStorage.setItem(ONBOARD_KEY, '1').catch(() => {})
    // Home becomes the root; the sign-in screen sits on top so its back arrow
    // has somewhere to go.
    router.replace('/')
    if (target === '/login') router.push('/login')
  }

  if (step === null) return <View style={styles.screen} />

  const slide = step === LANGUAGE ? null : SLIDES[step]
  const last = step === SLIDES.length - 1
  const Art = slide?.art

  return (
    <View style={styles.screen}>
      <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + 56 }]}>
        {slide ? (
          <>
            <View style={styles.stepMeter}>
              <T style={monoSemi(12, 16 / 12, { ls: 0.14, upper: true })}>{t('onb.step', { n: step + 1 })}</T>
              <View style={styles.bars}>
                {SLIDES.map((_, n) => (
                  <View
                    key={n}
                    style={[styles.pip, { backgroundColor: n < step ? C.ink : n === step ? C.coral : C.line }]}
                  />
                ))}
              </View>
            </View>
            {last ? null : (
              <Tap onPress={() => finish('/')} accessibilityRole="button" style={styles.skip}>
                <T style={[body(14, 20 / 14), styles.skipText]}>{t('onb.skip')}</T>
              </Tap>
            )}
          </>
        ) : (
          <Wordmark size={22} />
        )}
      </View>

      <View style={styles.page}>
        {slide && Art ? (
          <>
            <View style={styles.art}>
              <Art />
            </View>
            <View style={{ gap: 14, paddingTop: 30 }}>
              {step === 0 ? <Pill>{t('onb.chipTools')}</Pill> : step === 1 ? <Pill>2D · 3D</Pill> : null}
              <T style={disp(34, 1, { ls: -0.035 })}>{t(slide.title)}</T>
              <T style={body(16, 24 / 16, { color: C.i70 })}>{t(slide.body)}</T>
            </View>
          </>
        ) : (
          <View style={{ paddingTop: 28 }}>
            <LanguageChoice />
          </View>
        )}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 24), paddingTop: 16 }}>
        <Button
          title={`${t(last ? 'onb.start' : 'onb.next')} →`}
          onPress={() => {
            if (last) return finish('/login')
            // Leaving the language step stores the pick, even when the
            // highlighted default was kept.
            if (!slide) setLang(lang)
            setStep(step + 1)
          }}
        />
      </View>
    </View>
  )
}

/** The outlined mono tag over the heading ("matn · grafika · rang"). */
function Pill({ children }: { children: string }) {
  return (
    <View style={styles.pill}>
      <T style={monoSemi(12, 16 / 12, { ls: 0.14, upper: true })}>{children}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 8,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    backgroundColor: C.paper,
  },
  stepMeter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bars: { flexDirection: 'row', gap: 4 },
  pip: { width: 22, height: 4 },
  skip: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  skipText: { fontFamily: 'Inter_500Medium', textDecorationLine: 'underline' },
  page: { flex: 1, minHeight: 0, paddingHorizontal: 16 },
  art: { flexShrink: 1, minHeight: 0, paddingTop: 18 },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
})

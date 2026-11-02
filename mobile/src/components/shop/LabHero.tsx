import React, { useState } from 'react'
import { Image, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, offset } from '../../theme/tokens'
import { disp, kicker, mono, monoBold } from '../../theme/type'
import { GARMENT_FLAT } from '../../api/catalog'
import { useT } from '../../i18n'
import { ArrowRight } from './glyphs'
import { T, Tap } from '../ui'

/**
 * The LOOM Lab hero at the top of Home (W09). Mount it only while
 * `useLabEnabled()` is true: with the flag off Home has no Lab element at all
 * (PRD-210 D-3, App Store 2.1). The prompt hands off to `/lab` (W23), which
 * owns generating.
 */
export function LabHero() {
  const router = useRouter()
  const t = useT()
  const [prompt, setPrompt] = useState('')

  const go = (text: string) => {
    const p = text.trim()
    router.push(p ? { pathname: '/lab', params: { prompt: p } } : '/lab')
  }

  return (
    <View style={styles.hero} accessibilityLabel="LOOM Lab">
      <T style={kicker()}>{t('home.lab.kicker')}</T>
      <T style={disp(31, 1, { ls: -0.035 })}>{`${t('home.lab.t1')}\n${t('home.lab.t2')}`}</T>

      <View style={[styles.card, offset(3)]}>
        <View style={styles.field}>
          <View style={styles.tag}>
            <T style={monoBold(12, 16 / 12, { ls: 0.16, upper: true })}>{t('home.lab.tag')}</T>
          </View>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            onSubmitEditing={() => go(prompt)}
            returnKeyType="go"
            placeholder={t('home.lab.ph')}
            placeholderTextColor={C.i55}
            accessibilityLabel={t('home.lab.tag')}
            allowFontScaling={false}
            style={styles.input}
          />
          <Tap
            accessibilityRole="button"
            accessibilityLabel={t('home.lab.go')}
            onPress={() => go(prompt)}
            style={[styles.go, offset(2)]}
          >
            <ArrowRight />
          </Tap>
        </View>
        <View style={styles.fig}>
          <Image source={GARMENT_FLAT} style={styles.figImg} resizeMode="contain" />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips}>
        {(['home.lab.ex1', 'home.lab.ex2'] as const).map((k) => (
          <Tap key={k} accessibilityRole="button" onPress={() => go(t(k))} style={styles.chip}>
            <T style={disp(13, 1, { ls: 0.02 })}>{t(k)}</T>
          </Tap>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },
  card: { marginRight: 3, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, padding: 10, gap: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingVertical: 4,
    paddingLeft: 10,
    paddingRight: 4,
    borderWidth: RULE,
    borderColor: C.line,
  },
  tag: { paddingHorizontal: 6, paddingVertical: 3, backgroundColor: C.coral },
  input: { flex: 1, minWidth: 0, ...mono(14, 1.3), padding: 0 },
  go: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fig: { height: 164, backgroundColor: '#E6E1D5', alignItems: 'center', justifyContent: 'center' },
  figImg: { width: '100%', height: 150 },
  chipsScroll: { marginHorizontal: -16 },
  chips: { gap: 8, paddingHorizontal: 16, paddingTop: 4 },
  chip: {
    height: 44,
    paddingHorizontal: 14,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    justifyContent: 'center',
  },
})

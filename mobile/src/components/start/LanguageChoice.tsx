import React from 'react'
import { StyleSheet, View } from 'react-native'
import { C, RULE, noShadow, offset } from '../../theme/tokens'
import { disp, kicker, label } from '../../theme/type'
import { T, Tap } from '../ui'
import { LANGS, useI18n, type Lang } from '../../i18n'

// The language list shows uz first: the market's own language leads.
const ORDER: Lang[] = ['uz', 'ru', 'en']

const Slash = () => <T style={{ color: C.coral }}>/</T>

/**
 * W02 body: eyebrow, the heading in all three languages, and the radio list.
 * Picking a row applies at once (`setLang` also stores it as `loom_lang`), so
 * every string on the screen switches while the user is still looking at it.
 */
export function LanguageChoice() {
  const { lang, setLang, t } = useI18n()
  return (
    <View style={{ gap: 28 }}>
      <View style={{ gap: 12 }}>
        <T style={kicker()}>{t('onb.langEyebrow')}</T>
        <T style={disp(42, 1, { ls: -0.035 })}>
          Til <Slash />
          {'\n'}Язык <Slash />
          {'\n'}Language
        </T>
      </View>
      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {ORDER.map((id) => {
          const l = LANGS.find((x) => x.id === id)!
          const on = id === lang
          return (
            <Tap
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={l.label}
              accessibilityState={{ checked: on }}
              onPress={() => setLang(id)}
              style={[styles.row, on ? offset(3, C.coral) : noShadow]}
            >
              <View style={styles.radio}>{on ? <View style={styles.dot} /> : null}</View>
              <T style={[disp(20, 1.2, { ls: -0.02 }), { flex: 1 }]}>{l.label}</T>
              <T style={label()}>{l.short}</T>
            </Tap>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  radio: {
    width: 24,
    height: 24,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 12, height: 12, backgroundColor: C.ink },
})

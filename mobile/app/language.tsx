import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, noShadow, offset } from '../src/theme/tokens'
import { disp, label } from '../src/theme/type'
import { BackHeader } from '../src/components/AppBar'
import { T, Tap } from '../src/components/ui'
import { LANGS, useI18n } from '../src/i18n'
import { goBack } from '../src/lib/nav'

// W02 language choice. LOOM-246 stub: a working picker, reached from Account.
// LOOM-247 builds the designed screen and the onboarding step around it.
export default function Language() {
  const router = useRouter()
  const { lang, setLang, t } = useI18n()

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <BackHeader title={t('acc.language')} />
      <View style={styles.list}>
        {LANGS.map((l) => {
          const on = l.id === lang
          return (
            <Tap
              key={l.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => {
                setLang(l.id)
                goBack(router)
              }}
              style={[styles.row, on ? offset(3, C.coral) : noShadow]}
            >
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
  list: { padding: 16, gap: 12 },
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
})

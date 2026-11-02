import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { C, RULE, offset } from '../../theme/tokens'
import { label as labelType } from '../../theme/type'
import { useT } from '../../i18n'
import { Close } from '../icons'
import { T, Tap } from '../ui'

// Bars of the publish flow (W40–W44). Screens without the tab bar carry their
// own bottom action, on a 2px rule.

/** The pinned action area under the scroll: one or two full-width buttons. */
export function BottomBar({ children, rule = true }: { children: React.ReactNode; rule?: boolean }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.bottom,
        { paddingBottom: Math.max(insets.bottom, 12) + 12 },
        rule && { borderTopWidth: RULE, borderTopColor: C.ink },
      ]}
    >
      {children}
    </View>
  )
}

/** "1-qadam" and two bars: done = ink, current = accent, ahead = faint (W42, W43). */
export function StepMeter({ step, of = 2 }: { step: number; of?: number }) {
  const t = useT()
  return (
    <View style={styles.meter}>
      <T style={labelType(12, { color: C.ink })}>{t('pub.step', { n: step })}</T>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: of }, (_, i) => (
          <View
            key={i}
            style={{
              width: 18,
              height: 4,
              backgroundColor: i + 1 < step ? C.ink : i + 1 === step ? C.coral : C.line,
            }}
          />
        ))}
      </View>
    </View>
  )
}

/** The bar of the "sent" screen (W44): only a close square, on the right. */
export function CloseBar({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const t = useT()
  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + 56 }]}>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
        style={[styles.square, offset(2)]}
      >
        <Close size={20} width={2.4} />
      </Tap>
    </View>
  )
}

const styles = StyleSheet.create({
  bottom: { paddingTop: 12, paddingHorizontal: 16, gap: 10, backgroundColor: C.paper },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    backgroundColor: C.paper,
  },
  square: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

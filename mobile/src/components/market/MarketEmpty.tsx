import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useT } from '../../i18n'
import { C, RULE } from '../../theme/tokens'
import { body, disp, kicker } from '../../theme/type'
import { Plus } from '../icons'
import { Button, T, Tap } from '../ui'

/**
 * The market with nothing approved yet (W38): an open call to designers — dashed
 * slots, the first one a link — and one accent action to become a designer.
 * `title` replaces the headline when one category, not the whole market, is empty.
 */
export function MarketEmpty({ cta, onBecome, title }: { cta: string; onBecome: () => void; title?: string }) {
  const t = useT()
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 10 }}>
        <T style={kicker(12)}>{t('mk.openCall')}</T>
        <T style={disp(32, 1.02, { ls: -0.035 })}>{title ?? t('mk.emptyTitle')}</T>
        <T style={body(15, 22 / 15, { color: C.i70 })}>{t('mk.emptyBody')}</T>
      </View>

      <View style={styles.slots}>
        <Tap accessibilityRole="button" onPress={onBecome} style={[styles.slot, styles.slotYours]}>
          <View style={styles.plus}>
            <Plus size={20} width={2.6} />
          </View>
          <T style={disp(14, 18 / 14, { align: 'center' })}>{t('mk.slotYours')}</T>
        </Tap>
        <View style={[styles.slot, { borderColor: 'rgba(19,19,17,.3)' }]} />
        <View style={[styles.slot, { height: 110, borderColor: 'rgba(19,19,17,.2)' }]} />
        <View style={[styles.slot, { height: 110, borderColor: 'rgba(19,19,17,.2)' }]} />
      </View>

      <Button title={`${cta} →`} onPress={onBecome} />
    </View>
  )
}

const styles = StyleSheet.create({
  slots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  slot: { width: '48%', height: 170, borderWidth: RULE, borderStyle: 'dashed', borderColor: C.ink },
  slotYours: {
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 12,
  },
  plus: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

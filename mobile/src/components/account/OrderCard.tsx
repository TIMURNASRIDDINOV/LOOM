import React from 'react'
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native'

import { C, RULE, fmt, offset } from '../../theme/tokens'
import { disp, mono, monoSemi } from '../../theme/type'
import { GARMENT_FLAT } from '../../api/catalog'
import type { Order } from '../../api/types'
import { useT } from '../../i18n'
import { ChevronRight, Refresh } from '../icons'
import { T, Tap } from '../ui'
import { Send } from './icons'
import { dayLabel, lineCount } from './format'
import { StatusChip } from './StatusChip'

export const THUMB_BG = '#E6E1D5'

/** A garment thumbnail: the order list has no per-line pictures, so every line shows the flat garment. */
export function Thumb({ size, count = 1 }: { size: number; count?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.thumb, { width: size, height: size }]}>
          <Image source={GARMENT_FLAT} style={{ width: size - 6, height: size - 6 }} resizeMode="contain" />
        </View>
      ))}
    </View>
  )
}

/**
 * One order in the list (W30): number, date and status, what is in it, and two
 * actions. The newest order is `raised`.
 */
export function OrderCard({
  order,
  raised,
  repeating,
  onOpen,
  onTelegram,
  onRepeat,
}: {
  order: Order
  raised?: boolean
  repeating?: boolean
  onOpen: () => void
  onTelegram: () => void
  onRepeat: () => void
}) {
  const t = useT()
  const n = lineCount(order.design_json)
  return (
    <View style={[styles.card, raised && offset(2)]}>
      <Tap accessibilityRole="button" onPress={onOpen} style={styles.open}>
        <View style={styles.row}>
          <View style={{ gap: 2 }}>
            <T style={monoSemi(15, 20 / 15)}>{`#LM-${order.id}`}</T>
            <T style={mono(12, 4 / 3, { color: C.i70 })}>{dayLabel(order.created_at, t)}</T>
          </View>
          <StatusChip status={order.status} />
        </View>
        <View style={[styles.row, { alignItems: 'center', justifyContent: 'flex-start', gap: 10 }]}>
          <Thumb size={48} count={Math.min(n, 3)} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T style={disp(15, 19 / 15)}>{t('orders.orderFor', { price: fmt(order.total_price) })}</T>
            <T style={mono(12, 4 / 3, { color: C.i70 })}>{t('common.itemsN', { n })}</T>
          </View>
          <ChevronRight size={18} color={C.ink} width={2.4} />
        </View>
      </Tap>
      <View style={styles.actions}>
        <Tap accessibilityRole="button" onPress={onTelegram} style={[styles.action, { borderRightWidth: RULE, borderRightColor: C.ink }]}>
          <Send size={16} width={2.4} />
          <T style={disp(13, 1)}>{t('orders.telegram')}</T>
        </Tap>
        <Tap accessibilityRole="button" disabled={repeating} onPress={onRepeat} style={styles.action}>
          {repeating ? <ActivityIndicator size="small" color={C.ink} /> : <Refresh size={16} />}
          <T style={disp(13, 1)}>{t('orders.repeat')}</T>
        </Tap>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  open: { paddingTop: 12, paddingHorizontal: 12, paddingBottom: 10, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  thumb: { borderWidth: 1.5, borderColor: C.ink, backgroundColor: THUMB_BG, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', borderTopWidth: RULE, borderTopColor: C.ink },
  action: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 6,
    backgroundColor: C.white,
  },
})

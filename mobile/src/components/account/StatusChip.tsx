import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { C } from '../../theme/tokens'
import { monoBold } from '../../theme/type'
import { statusLabel, useT } from '../../i18n'
import { T } from '../ui'

/** Colour of the square in a status chip: ink once delivered, red when cancelled, accent while in progress. */
export function statusDot(status: string): string {
  return status === 'delivered' ? C.ink : status === 'cancelled' ? C.deep : C.coral
}

/** The order status as a bordered chip with a colour square (W30, W31). */
export function StatusChip({ status, style }: { status: string; style?: StyleProp<ViewStyle> }) {
  const t = useT()
  return (
    <View style={[styles.chip, style]}>
      <View style={[styles.dot, { backgroundColor: statusDot(status) }]} />
      <T style={monoBold(12, 4 / 3, { ls: 0.08, upper: true })}>{statusLabel(status, t)}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1.5,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  dot: { width: 8, height: 8 },
})

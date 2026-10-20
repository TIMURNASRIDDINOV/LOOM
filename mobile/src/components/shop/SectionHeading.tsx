import React from 'react'
import { StyleSheet, View } from 'react-native'

import { C, HAIR } from '../../theme/tokens'
import { kicker, mono } from '../../theme/type'
import { T, Tap } from '../ui'

/**
 * The section head of Home and Catalog (W09, W10): an accent-deep mono
 * eyebrow, then a link (44px target) or a plain note, on a hairline.
 */
export function SectionHeading({
  title,
  action,
  onAction,
  note,
}: {
  title: string
  action?: string
  onAction?: () => void
  note?: string
}) {
  return (
    <View style={styles.head}>
      <T style={[kicker(), { flexShrink: 1 }]} numberOfLines={1}>
        {title}
      </T>
      {action ? (
        <Tap accessibilityRole="link" onPress={onAction} style={styles.action}>
          <T style={mono(12, 16 / 12, { ls: 0.08, color: C.i70 })}>{action}</T>
        </Tap>
      ) : note ? (
        <T style={[mono(12, 16 / 12, { color: C.i70 }), styles.note]} numberOfLines={1}>
          {note}
        </T>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: HAIR,
    borderBottomColor: C.line,
  },
  action: { minHeight: 44, justifyContent: 'center' },
  note: { flexShrink: 1, paddingBottom: 6 },
})

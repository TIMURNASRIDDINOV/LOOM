import React from 'react'
import { StyleSheet, View } from 'react-native'

import { C, HAIR, RULE } from '../../theme/tokens'
import { body, bodyMed, mono } from '../../theme/type'
import { ChevronRight } from '../icons'
import { Badge, T, Tap } from '../ui'

// The account lists (W33, W34): bordered white groups of 56px rows, a hairline
// between rows.

export function NavGroup({ children, label }: { children: React.ReactNode; label?: string }) {
  const rows = React.Children.toArray(children).filter(Boolean)
  return (
    <View accessibilityLabel={label} style={styles.group}>
      {rows.map((row, i) => (
        <View key={i} style={i < rows.length - 1 && styles.rule}>
          {row}
        </View>
      ))}
    </View>
  )
}

export function NavRow({
  icon,
  label,
  sub,
  trailing,
  badge,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  /** A second line (W33 address, personal data): the row grows to 60. */
  sub?: string
  /** Mono value before the chevron, e.g. the current language. */
  trailing?: string
  badge?: string
  onPress: () => void
}) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={onPress}
      style={[styles.row, sub ? { minHeight: 60, paddingVertical: 8 } : null]}
    >
      <View style={styles.icon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T style={bodyMed(15, 20 / 15)} numberOfLines={1}>
          {label}
        </T>
        {sub ? (
          <T style={body(12, 16 / 12, { color: C.i70 })} numberOfLines={1}>
            {sub}
          </T>
        ) : null}
      </View>
      {badge ? <Badge text={badge} /> : null}
      {trailing ? <T style={mono(13, 18 / 13, { color: C.i70 })}>{trailing}</T> : null}
      <ChevronRight size={16} color={C.ink} width={2.4} />
    </Tap>
  )
}

const styles = StyleSheet.create({
  group: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  rule: { borderBottomWidth: HAIR, borderBottomColor: C.line },
  row: { minHeight: 56, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.white },
  icon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
})

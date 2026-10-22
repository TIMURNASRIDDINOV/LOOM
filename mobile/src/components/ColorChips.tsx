import React from 'react'
import { StyleSheet, View } from 'react-native'

import { C } from '../theme/tokens'
import { monoSemi } from '../theme/type'
import { colorName, useT } from '../i18n'
import { useToast } from '../state/toast'
import { Swatch, T } from './ui'

/** One colour on offer. `reason` is the toast shown when it cannot be chosen. */
export type ColorChip = { hex: string; name: string; available: boolean; reason?: string }

/**
 * The one colour picker (LOOM-260): garment colour in the Studio and the blank
 * form, and text colour. A "<label> · <name>" line over a row of 44×44 chips
 * (W13, W20, W22). The row wraps rather than shrinking a chip, so a small phone
 * with many colours keeps every target at 44 pt. An unavailable chip is struck
 * through and says why when tapped; the choice does not change.
 */
export function ColorChips({
  label,
  chips,
  value,
  onChange,
}: {
  /** "Rang" / "Цвет" / "Colour" — the part before the chosen name. */
  label: string
  chips: ColorChip[]
  /** The chosen colour's hex. */
  value: string
  onChange: (hex: string) => void
}) {
  const t = useT()
  const { flash } = useToast()
  const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()
  const chosen = chips.find((c) => same(c.hex, value))
  const name = chosen?.name ?? colorName(value, t)

  return (
    <View>
      <T style={styles.label}>
        {label} · <T style={styles.name}>{name}</T>
      </T>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {chips.map((c) => (
          <Swatch
            key={c.hex}
            hex={c.hex}
            label={c.available ? c.name : `${c.name}, ${t('st.unavailable')}`}
            selected={same(c.hex, value)}
            unavailable={!c.available}
            onPress={() => {
              if (!c.available) flash(c.reason ?? t('st.colorUnavailable'))
              else if (!same(c.hex, value)) onChange(c.hex)
            }}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // 12 pt floor, ink at 72% for the lead-in and full ink for the name (W22).
  label: { ...monoSemi(12, 4 / 3, { ls: 0.04, color: C.i70 }), marginBottom: 8 },
  name: monoSemi(12, 4 / 3, { ls: 0.04, color: C.ink }),
  // The shadow of the chosen chip reaches 3 pt right and down; the gap clears it.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
})

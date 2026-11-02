import React from 'react'
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { C, RULE, fmt, offset } from '../../theme/tokens'
import { dispSemi, mono } from '../../theme/type'
import { productImage } from '../../api/catalog'
import type { Product } from '../../api/types'
import { productName, useI18n } from '../../i18n'
import { productConfig, swatchName } from '../../lib/product-config'
import { T } from '../ui'

/**
 * A catalogue cell (W09, W10): a white tile with hard-sm, an `Apparel · 01`
 * eyebrow, the name, the server's price and the colour dots. Pressed, the tile
 * lifts 6px on an accent shadow (W-Web-System). Cells draw their own right and
 * bottom rule; wrap them in `ProductGrid` for the left and top.
 */
export function ProductCard({
  product: p,
  index,
  onPress,
  style,
}: {
  product: Product
  /** 1-based position, printed as `01`. */
  index: number
  onPress: () => void
  style?: StyleProp<ViewStyle>
}) {
  const { t, lang } = useI18n()
  const colors = productConfig(p).colors.filter((c) => c.available).slice(0, 4)
  const name = productName(p, lang)
  const price = `${fmt(p.price)} ${t('common.sum')}`

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${price}`}
      onPress={onPress}
      style={[styles.cell, style]}
    >
      {({ pressed }) => (
        <>
          <View style={[styles.tile, pressed ? offset(6, C.coral) : offset(2)]}>
            <Image source={productImage(p)} style={styles.img} resizeMode="contain" />
          </View>
          <T style={mono(12, 4 / 3, { ls: 0.14, upper: true, color: C.i70 })}>{`Apparel · ${String(index).padStart(2, '0')}`}</T>
          <T style={dispSemi(15, 19 / 15)} numberOfLines={2}>
            {name}
          </T>
          <View style={styles.row}>
            <T style={mono(13, 18 / 13)}>{price}</T>
            {colors.length > 0 ? (
              <View
                style={styles.dots}
                accessible
                accessibilityLabel={colors.map((c) => swatchName(c, lang, t)).join(', ')}
              >
                {colors.map((c) => (
                  <View key={c.hex} style={[styles.dot, { backgroundColor: c.hex }]} />
                ))}
              </View>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  )
}

/** The 2-column rule grid the cells sit in: ink on the left and top, cells add right and bottom. */
export function ProductGrid({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <View style={[styles.grid, muted && { borderColor: C.line }]}>{children}</View>
}

/** Loading cell (W11): the grid cell with a `Skeleton` inside. */
export const cellStyle = (muted?: boolean): ViewStyle => ({
  width: '50%',
  padding: 10,
  borderRightWidth: RULE,
  borderBottomWidth: RULE,
  borderColor: muted ? C.line : C.ink,
})

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderLeftWidth: RULE,
    borderTopWidth: RULE,
    borderColor: C.ink,
  },
  cell: {
    width: '50%',
    padding: 10,
    gap: 7,
    borderRightWidth: RULE,
    borderBottomWidth: RULE,
    borderColor: C.ink,
  },
  tile: {
    height: 146,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    // The lift grows past the tile; keep neighbours from clipping it.
    zIndex: 1,
  },
  img: { width: '100%', height: 122 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 12, height: 12, borderWidth: 1.5, borderColor: C.i38 },
})

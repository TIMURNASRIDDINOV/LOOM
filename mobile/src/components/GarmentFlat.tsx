import React from 'react'
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { C, HAIR } from '../theme/tokens'
import { GARMENT_FLAT } from '../api/catalog'

/**
 * The flat garment scan with its print boundary.
 *
 * The PNG is square, so the image is wrapped in a square box and the boundary
 * is positioned against THAT rather than the outer frame — which is what keeps
 * the dashed rectangle on the torso instead of floating over the sleeves and
 * past the hem. Works in any frame that is square or wider than tall.
 *
 * Geometry measured off the PNG's own alpha channel: the body runs x 27.8%–
 * 72.4% and the hem sits at y 84%, so a 36.5%–63.5% × 40%–76% box lands on
 * the chest with clearance on every side.
 */
export function GarmentFlat({
  style,
  children,
  /** The PNG carries ~25% transparent margin; scale up to crop into it. */
  scale = 1,
}: {
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  scale?: number
}) {
  return (
    <View style={[styles.box, scale !== 1 && { transform: [{ scale }] }, style]}>
      <Image source={GARMENT_FLAT} style={styles.img} resizeMode="contain" />
      <View style={styles.print} />
      {children}
    </View>
  )
}

/** The print boundary's own edges, for art that has to sit inside it. */
export const PRINT_BOX = { left: '36.5%', top: '40%', width: '27%', height: '36%' } as const

const styles = StyleSheet.create({
  box: { height: '100%', aspectRatio: 1, alignSelf: 'center' },
  img: { width: '100%', height: '100%' },
  print: {
    position: 'absolute',
    left: PRINT_BOX.left,
    top: PRINT_BOX.top,
    width: PRINT_BOX.width,
    aspectRatio: 3 / 4,
    borderWidth: HAIR,
    borderStyle: 'dashed',
    borderColor: C.i38,
  },
})

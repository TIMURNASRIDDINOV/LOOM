import React from 'react'
import { StyleSheet, View } from 'react-native'
import { C, RULE } from '../theme/tokens'
import { body as bodyType, disp, mono } from '../theme/type'
import { Hatch } from './ArtPattern'
import { GarmentFlat } from './GarmentFlat'
import { Button, T } from './ui'

/**
 * The one shape every "there is nothing here" moment takes.
 *
 * Seven screens needed this and each had grown its own: `publish` had an
 * eyebrow and a headline, `orders` and `cart` a headline alone, `product`
 * and `designer` nothing but unstyled body text — and all of them left most
 * of the screen blank. One component so the app answers emptiness the same
 * way every time, and so the answer looks like LOOM rather than a fallback.
 *
 * The anchor is the flat garment with its print area empty: the same device
 * the onboarding and the studio use, and it says the thing the copy says.
 */
export function EmptyState({
  eyebrow,
  title,
  body,
  action,
  secondary,
  art = true,
}: {
  eyebrow?: string
  title: string
  body?: string
  action?: { title: string; onPress: () => void }
  secondary?: { title: string; onPress: () => void }
  /** Off for states that sit inside an already-busy screen. */
  art?: boolean
}) {
  return (
    <View style={styles.wrap}>
      {art ? (
        <Hatch style={styles.frame}>
          <GarmentFlat />
        </Hatch>
      ) : null}

      <View style={styles.copy}>
        {eyebrow ? (
          <T style={mono(10.5, 1, { ls: 0.16, upper: true, color: C.coral })}>{eyebrow}</T>
        ) : null}
        {/* Ink, not coral: every other headline in the app is ink, and cart
            was the only screen that broke that. */}
        <T style={[disp(26, 1.1, { ls: -0.02, color: C.ink }), styles.title]}>{title}</T>
        {body ? <T style={[bodyType(13.5, 1.6, { color: C.i55 }), styles.body]}>{body}</T> : null}
      </View>

      {action || secondary ? (
        <View style={styles.actions}>
          {action ? (
            <Button
              title={action.title}
              variant="ink"
              size={12.5}
              vPad={15}
              style={styles.cta}
              onPress={action.onPress}
            />
          ) : null}
          {secondary ? (
            <Button
              title={secondary.title}
              variant="outline"
              size={12.5}
              vPad={15}
              style={styles.cta}
              onPress={secondary.onPress}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28, gap: 22 },
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  copy: { gap: 10 },
  title: { maxWidth: 300 },
  body: { maxWidth: 320 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cta: { alignSelf: 'flex-start', paddingHorizontal: 26 },
})

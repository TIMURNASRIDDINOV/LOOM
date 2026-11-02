import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native'

import { C, RULE } from '../../theme/tokens'
import { dispSemi, dispExtra, mono } from '../../theme/type'
import { T } from '../ui'

// px per second — slow enough to read, fast enough to notice.
const SPEED = 36

/**
 * The 52px wordmark band (W-Web-System): phrase, accent slash, mono tail,
 * looping. The strip is drawn twice and slid by exactly one copy's measured
 * width, so any language's text loops without a seam. Static when the phone
 * asks for reduced motion.
 */
export function Marquee({ items }: { items: { text: string; tail: string }[] }) {
  const x = useRef(new Animated.Value(0)).current
  const [width, setWidth] = useState(0)
  const [still, setStill] = useState(false)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill)
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!width || still) {
      x.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -width,
        duration: (width / SPEED) * 1000,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [x, width, still])

  const strip = (hidden?: boolean) => (
    <View
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      onLayout={hidden ? undefined : (e) => setWidth(e.nativeEvent.layout.width)}
      style={styles.strip}
    >
      {items.map((it) => (
        <View key={it.text} style={styles.unit}>
          <T style={dispSemi(20, 1, { ls: -0.02 })}>{it.text}</T>
          <T style={dispExtra(20, 1, { color: C.coral })}>/</T>
          <T style={mono(12, 16 / 12, { ls: 0.22, upper: true, color: C.i70 })}>{it.tail}</T>
        </View>
      ))}
    </View>
  )

  return (
    <View style={styles.band}>
      <Animated.View style={[styles.track, { transform: [{ translateX: x }] }]}>
        {strip()}
        {still ? null : strip(true)}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  band: {
    height: 52,
    overflow: 'hidden',
    justifyContent: 'center',
    borderTopWidth: RULE,
    borderBottomWidth: RULE,
    borderColor: C.ink,
  },
  // Wider than the band: the track is as long as its two copies.
  track: { flexDirection: 'row', alignItems: 'center', width: 4000 },
  strip: { flexDirection: 'row', alignItems: 'center' },
  unit: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingRight: 18, paddingLeft: 16 },
})

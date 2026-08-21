import React, { useCallback, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'

import { C, RULE } from '../theme/tokens'

// Hand-rolled rather than pulling in a native slider: the design's control is a
// 26px-tall hairline track with a square ink thumb, which no platform slider
// gives you, and this keeps the app runnable in Expo Go.

const THUMB = 22
const TRACK = 3

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  const [width, setWidth] = useState(0)

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width)
  }, [])

  const commit = useCallback(
    (x: number) => {
      if (width <= THUMB) return
      const ratio = Math.min(1, Math.max(0, (x - THUMB / 2) / (width - THUMB)))
      const raw = min + ratio * (max - min)
      const snapped = Math.round(raw / step) * step
      onChange(Math.min(max, Math.max(min, snapped)))
    },
    [width, min, max, step, onChange],
  )

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => runOnJS(commit)(e.x))
    .onChange((e) => runOnJS(commit)(e.x))

  const ratio = max === min ? 0 : (value - min) / (max - min)
  const left = ratio * Math.max(0, width - THUMB)

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.hit} onLayout={onLayout}>
        <View style={styles.track} />
        <View style={[styles.fill, { width: left + THUMB / 2 }]} />
        <View style={[styles.thumb, { left }]} />
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  hit: { height: 26, justifyContent: 'center' },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK,
    backgroundColor: 'rgba(19,19,17,.12)',
  },
  fill: { position: 'absolute', left: 0, height: TRACK, backgroundColor: C.coral },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
})

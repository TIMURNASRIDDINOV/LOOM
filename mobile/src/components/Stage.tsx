import React from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'

import { C, RULE } from '../theme/tokens'
import { disp, mono } from '../theme/type'
import { GARMENT_FLAT } from '../api/catalog'
import { useStudio } from '../state/studio'
import { ArtPattern } from './ArtPattern'
import { T, Tap } from './ui'

// The print rect is 46% of the garment's width, 4:5, starting 30% down — the
// numbers come straight from the prototype's stage, and the "печать 28×35 см"
// caption is what makes the scale legible.
const PRINT_W = 0.46
const PRINT_TOP = 0.3

export function Stage({ readyImage }: { readyImage?: string | null }) {
  const { s, active, surface, artSelected, selectArt, updateArt, pickTool, closeTool } = useStudio()
  const art = active.art
  const text = active.text

  // Coarse placement by drag; the inspector owns the 1 mm precision.
  const pan = Gesture.Pan()
    .enabled(!!art)
    .onChange((e) => {
      if (!art) return
      runOnJS(updateArt)({
        offset: { x: art.offset.x + e.changeX * 0.28, y: art.offset.y + e.changeY * 0.28 },
      })
    })

  if (surface === '3d') {
    return (
      <View style={styles.preview3d}>
        <Image
          source={readyImage ? { uri: readyImage } : require('../../assets/products/tshirt_regular_white_002.jpg')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        {art ? (
          <View
            style={[
              styles.art3d,
              {
                width: `${art.sizePct * 0.42}%`,
                transform: [{ translateX: '-50%' }, { rotate: `${art.rotation}deg` }],
              },
            ]}
          >
            <ArtLayerVisual art={art} />
          </View>
        ) : null}
        <View style={styles.badge3d}>
          <T style={mono(8.5, 1, { ls: 0.18, upper: true, color: C.i38 })}>превью 3D</T>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.stage}>
      <View style={styles.garmentBox}>
      <Image source={GARMENT_FLAT} style={styles.garment} resizeMode="contain" />

      {/* Garment colour multiplies over the flat scan. */}
      {s.color !== '#FFFFFF' ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: s.color, opacity: 0.24 }]}
        />
      ) : null}

      {/* Print boundary */}
      <View pointerEvents="none" style={styles.printRect}>
        <T style={[mono(7.5, 1, { ls: 0.16, upper: true, color: C.i38 }), styles.printLabel]}>
          печать 28×35 см
        </T>
      </View>

      {text?.content ? (
        <View pointerEvents="none" style={styles.textLayer}>
          <T
            style={[
              disp(text.size, 1.1, { color: text.color, align: 'center' }),
              { transform: [{ rotate: `${text.rotation}deg` }] },
            ]}
          >
            {text.content}
          </T>
        </View>
      ) : null}

      {art ? (
        <GestureDetector gesture={pan}>
          <View
            style={[
              styles.artLayer,
              {
                width: `${art.sizePct * PRINT_W}%`,
                marginLeft: art.offset.x,
                marginTop: art.offset.y,
                transform: [
                  { translateX: '-50%' },
                  { translateY: '-50%' },
                  { rotate: `${art.rotation}deg` },
                ],
                borderColor: artSelected ? C.coral : 'rgba(19,19,17,.3)',
                borderWidth: artSelected ? RULE : 1,
                borderStyle: artSelected ? 'solid' : 'dashed',
              },
            ]}
          >
            <Tap
              style={StyleSheet.absoluteFill}
              onPress={() => {
                selectArt(!artSelected)
                closeTool()
              }}
            >
              <ArtLayerVisual art={art} />
            </Tap>
            {artSelected ? (
              <>
                <View style={[styles.handle, { left: -5, top: -5 }]} />
                <View style={[styles.handle, { right: -5, top: -5 }]} />
                <View style={[styles.handle, { left: -5, bottom: -5 }]} />
                <View style={[styles.handle, { right: -5, bottom: -5 }]} />
                <View style={styles.rotHandle} />
              </>
            ) : null}
          </View>
        </GestureDetector>
      ) : null}

      {!art && !text?.content ? (
        <Tap style={styles.emptyDrop} onPress={() => pickTool('image')}>
          <View style={styles.plus}>
            <T style={{ fontSize: 20, lineHeight: 24, color: C.i55 }}>+</T>
          </View>
          <T style={disp(11, 1.15, { ls: 0.02, upper: true, color: C.i55, align: 'center' })}>
            Добавить дизайн
          </T>
        </Tap>
      ) : null}
      </View>
    </View>
  )
}

function ArtLayerVisual({ art }: { art: NonNullable<ReturnType<typeof useStudio>['active']['art']> }) {
  if (art.uri) {
    return <Image source={{ uri: art.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
  }
  if (art.pattern) {
    return (
      <ArtPattern
        angle={art.pattern.angle}
        color={art.pattern.color}
        gap={art.pattern.gap}
        band={2}
        background="rgba(255,255,255,.3)"
        style={StyleSheet.absoluteFill}
      />
    )
  }
  return null
}

const styles = StyleSheet.create({
  stage: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  // The flat scan is square, so the box that carries every overlay is square
  // too. Width drives it: on a portrait phone the stage is always taller than
  // it is wide, so width is the dimension that runs out first.
  garmentBox: { width: '100%', aspectRatio: 1, maxHeight: '100%' },
  garment: { width: '100%', height: '100%' },

  printRect: {
    position: 'absolute',
    top: `${PRINT_TOP * 100}%`,
    left: '50%',
    transform: [{ translateX: '-50%' }],
    width: `${PRINT_W * 100}%`,
    aspectRatio: 4 / 5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.i38,
  },
  printLabel: { position: 'absolute', top: -15, left: 0 },

  textLayer: {
    position: 'absolute',
    top: '34%',
    left: '50%',
    transform: [{ translateX: '-50%' }],
    width: `${PRINT_W * 100}%`,
    alignItems: 'center',
  },

  // Anchored by its centre, matching the prototype's `top:48%; left:50%`.
  artLayer: { position: 'absolute', top: '48%', left: '50%', aspectRatio: 1 },
  handle: { position: 'absolute', width: 9, height: 9, backgroundColor: C.white, borderWidth: RULE, borderColor: C.coral },
  rotHandle: {
    position: 'absolute',
    left: '50%',
    top: -22,
    marginLeft: -5.5,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: C.white,
    borderWidth: RULE,
    borderColor: C.coral,
  },

  emptyDrop: {
    position: 'absolute',
    top: `${PRINT_TOP * 100}%`,
    left: '50%',
    transform: [{ translateX: '-50%' }],
    width: `${PRINT_W * 100}%`,
    aspectRatio: 4 / 5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  plus: {
    width: 30,
    height: 30,
    borderWidth: 2,
    borderColor: C.i55,
    alignItems: 'center',
    justifyContent: 'center',
  },

  preview3d: {
    height: '100%',
    aspectRatio: 4 / 5,
    maxWidth: '100%',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    overflow: 'hidden',
  },
  art3d: { position: 'absolute', top: '26%', left: '50%', aspectRatio: 1 },
  badge3d: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,.85)',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
})

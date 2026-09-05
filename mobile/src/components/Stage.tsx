import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'

import { C, RULE } from '../theme/tokens'
import { mono } from '../theme/type'
import { GARMENT_FLAT } from '../api/catalog'
import { cachedSrc, toDisplayableSrc } from '../lib/files'
import { IMAGE_FRAC_AT_100, PLATEN_CM, REF_RECT, toSceneDesign } from '../lib/print'
import { useStudio, type ArtLayer, type TextLayer } from '../state/studio'
import { ArtPattern } from './ArtPattern'
import { Model3D } from './Model3D'
import { T, Tap } from './ui'
import { useT } from '../i18n'

// The flat stage. The print rect is 46% of the garment's width, starting 30%
// down (from the prototype), and its aspect is the real platen — 30 × 40 cm —
// so a layer's percent offset means the same centimetres here, on the 3D
// garment and on the print master.
const PRINT_W = 0.46
const PRINT_TOP = 0.3
const PRINT_ASPECT = PLATEN_CM.h / PLATEN_CM.w

const FONT_FAMILY: Record<string, string> = {
  'Inter Tight': 'InterTight_700Bold',
  Inter: 'Inter_600SemiBold',
  'IBM Plex Mono': 'IBMPlexMono_700Bold',
}

export function Stage({
  glbUrl,
}: {
  /** `glb_url` from the product API — drives the real 3D preview. */
  glbUrl?: string | null
}) {
  const st = useStudio()
  const t = useT()
  const { s, active, face, surface, artSelected, textSelected } = st

  if (surface === '3d') {
    return <Stage3D glbUrl={glbUrl ?? null} />
  }

  return (
    <View style={styles.stage}>
      <Flat
        art={active.art}
        text={active.text}
        color={s.color}
        artSelected={artSelected}
        textSelected={textSelected}
        onSelectArt={(v) => {
          st.selectArt(v)
          st.closeTool()
        }}
        onSelectText={(v) => {
          st.selectText(v)
          st.closeTool()
        }}
        onMoveArt={(dx, dy) => st.updateArt({ offset: { x: (active.art?.offset.x ?? 0) + dx, y: (active.art?.offset.y ?? 0) + dy } })}
        onMoveText={(dx, dy) => st.setText({ offset: { x: (active.text?.offset.x ?? 0) + dx, y: (active.text?.offset.y ?? 0) + dy } })}
        onEmptyTap={() => st.pickTool('image')}
        faceLabel={face === 'front' ? t('st.frontLower') : t('st.backLower')}
      />
    </View>
  )
}

// ─── 3D ──────────────────────────────────────────────────────────────────────

function Stage3D({ glbUrl }: { glbUrl: string | null }) {
  const { s, face } = useStudio()
  // Local uploads are inlined as data: URIs for the WebView; this counter
  // re-renders once a read completes so the scene picks the bitmap up.
  const [, bump] = useState(0)
  const uris = [s.front.art, s.back.art].filter((a): a is ArtLayer => !!a?.uri && !a.pattern)
  useEffect(() => {
    let alive = true
    uris.forEach((a) => {
      if (cachedSrc(a.uri) || !a.uri) return
      toDisplayableSrc(a.uri, a.mime ?? 'image/png')
        .then(() => alive && bump((n) => n + 1))
        .catch(() => {})
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uris.map((a) => a.uri).join('|')])

  const design = useMemo(() => toSceneDesign(s, cachedSrc), [s])

  return (
    <View style={styles.preview3d}>
      <Model3D key={glbUrl ?? 'default'} glbUrl={glbUrl} design={design} view={face} />
    </View>
  )
}

// ─── 2D ──────────────────────────────────────────────────────────────────────

function Flat({
  art,
  text,
  color,
  artSelected,
  textSelected,
  onSelectArt,
  onSelectText,
  onMoveArt,
  onMoveText,
  onEmptyTap,
  faceLabel,
}: {
  art: ArtLayer | null
  text: TextLayer | null
  color: string
  artSelected: boolean
  textSelected: boolean
  onSelectArt: (v: boolean) => void
  onSelectText: (v: boolean) => void
  onMoveArt: (dxPct: number, dyPct: number) => void
  onMoveText: (dxPct: number, dyPct: number) => void
  onEmptyTap: () => void
  faceLabel: string
}) {
  const t = useT()
  const [W, setW] = useState(0)
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), [])

  // Print rect in points, from the measured garment box.
  const rect = useMemo(() => {
    const w = W * PRINT_W
    const h = w * PRINT_ASPECT
    return { x: (W - w) / 2, y: W * PRINT_TOP, w, h, cx: W / 2, cy: W * PRINT_TOP + h / 2 }
  }, [W])

  const panArt = Gesture.Pan()
    .enabled(!!art && rect.w > 0)
    .onChange((e) => {
      runOnJS(onMoveArt)((e.changeX / rect.w) * 100, (e.changeY / rect.h) * 100)
    })
  const panText = Gesture.Pan()
    .enabled(!!text?.content && rect.w > 0)
    .onChange((e) => {
      runOnJS(onMoveText)((e.changeX / rect.w) * 100, (e.changeY / rect.h) * 100)
    })

  // Image long edge, in points — the web's drawElementIn formula.
  const artSize = art ? (art.sizePct / 100) * IMAGE_FRAC_AT_100 * rect.w : 0
  const artLeft = art ? rect.cx + (art.offset.x / 100) * rect.w - artSize / 2 : 0
  const artTop = art ? rect.cy + (art.offset.y / 100) * rect.h - artSize / 2 : 0

  const textPx = text ? text.size * (rect.h / REF_RECT.h) : 0
  const textCx = text ? rect.cx + (text.offset.x / 100) * rect.w : 0
  const textCy = text ? rect.cy + (text.offset.y / 100) * rect.h : 0
  const textBoxW = rect.w * 0.98

  const empty = !art && !text?.content

  return (
    <View style={styles.garmentBox} onLayout={onLayout}>
      <Image source={GARMENT_FLAT} style={styles.garment} resizeMode="contain" />

      {/* Garment colour multiplies over the flat scan. */}
      {color.toUpperCase() !== '#FFFFFF' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: 0.24 }]} />
      ) : null}

      {W > 0 ? (
        <>
          {/* Print boundary */}
          <View pointerEvents="none" style={[styles.printRect, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}>
            <T style={[mono(7.5, 1, { ls: 0.16, upper: true, color: C.i38 }), styles.printLabel]}>
              {t('st.print', { w: PLATEN_CM.w, h: PLATEN_CM.h, face: faceLabel })}
            </T>
          </View>

          {text?.content ? (
            <GestureDetector gesture={panText}>
              <View
                style={[
                  styles.textLayer,
                  {
                    left: textCx - textBoxW / 2,
                    top: textCy - textPx * 0.7,
                    width: textBoxW,
                    height: textPx * 1.4,
                    transform: [{ rotate: `${text.rotation}deg` }],
                    borderColor: textSelected ? C.coral : 'transparent',
                  },
                ]}
              >
                <Tap style={StyleSheet.absoluteFill} onPress={() => onSelectText(!textSelected)}>
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <T
                      numberOfLines={1}
                      style={{
                        fontFamily: FONT_FAMILY[text.font] ?? FONT_FAMILY['Inter Tight'],
                        fontSize: textPx,
                        lineHeight: textPx * 1.15,
                        color: text.color,
                        textAlign: 'center',
                        maxWidth: textBoxW,
                      }}
                    >
                      {text.content}
                    </T>
                  </View>
                </Tap>
              </View>
            </GestureDetector>
          ) : null}

          {art ? (
            <GestureDetector gesture={panArt}>
              <View
                style={[
                  styles.artLayer,
                  {
                    left: artLeft,
                    top: artTop,
                    width: artSize,
                    height: artSize,
                    transform: [{ rotate: `${art.rotation}deg` }],
                    borderColor: artSelected ? C.coral : 'rgba(19,19,17,.3)',
                    borderWidth: artSelected ? RULE : 1,
                    borderStyle: artSelected ? 'solid' : 'dashed',
                  },
                ]}
              >
                <Tap style={StyleSheet.absoluteFill} onPress={() => onSelectArt(!artSelected)}>
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

          {empty ? (
            <Tap style={[styles.emptyDrop, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]} onPress={onEmptyTap}>
              <View style={styles.plus}>
                <T style={{ fontSize: 20, lineHeight: 24, color: C.i55 }}>+</T>
              </View>
              <T style={[mono(9.5, 1.3, { ls: 0.12, upper: true, color: C.i55, align: 'center' })]}>{t('st.addDesign')}</T>
            </Tap>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

export function ArtLayerVisual({ art }: { art: ArtLayer }) {
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

  printRect: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed', borderColor: C.i38 },
  printLabel: { position: 'absolute', top: -15, left: 0 },

  textLayer: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed' },
  artLayer: { position: 'absolute' },
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

  emptyDrop: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 6 },
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
    backgroundColor: C.paper,
    overflow: 'hidden',
  },
})

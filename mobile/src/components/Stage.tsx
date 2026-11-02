import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Platform, StyleSheet, View, type ImageSourcePropType, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'

import { C, RULE } from '../theme/tokens'
import { mono } from '../theme/type'
import { GARMENT_FLAT } from '../api/catalog'
import { cachedSrc, toDisplayableSrc } from '../lib/files'
import { IMAGE_FRAC_AT_100, REF_RECT, toSceneDesign, type SceneDesign } from '../lib/print'
import { DEFAULT_PRINT_AREA, type FlatArt } from '../lib/product-config'
import type { FabricKey } from '../lib/scene-html'
import type { PrintArea } from '../api/types'
import { useStudio, type ArtLayer, type TextLayer } from '../state/studio'
import { ArtPattern } from './ArtPattern'
import { Model3D } from './Model3D'
import { T, Tap } from './ui'
import { useT } from '../i18n'

// The flat stage. At the default print area the print rect is 46% of the
// garment's width, starting 30% down (from the prototype), and its aspect is
// the real platen, so a layer's percent offset means the same centimetres here,
// on the 3D garment and on the print master. A product's print area (LOOM-166)
// scales the width and drop from those seeds, as on the web.
const PRINT_W = 0.46
const PRINT_TOP = 0.3

export function flatRect(W: number, pa: PrintArea) {
  const w = W * PRINT_W * (pa.width_frac / DEFAULT_PRINT_AREA.width_frac)
  const h = w * (pa.platen_cm.h / pa.platen_cm.w)
  const y = W * (PRINT_TOP - DEFAULT_PRINT_AREA.top_frac * PRINT_W) + pa.top_frac * w
  return { x: (W - w) / 2, y, w, h, cx: W / 2, cy: y + h / 2 }
}

// mixBlendMode needs Android 10 (API 29); iOS and web have it.
const BLEND = Platform.OS !== 'android' || Number(Platform.Version) >= 29
const TEE_FLAT = /\/configuratorprodutcs\/tshirt_flat_white_1200\.png$/

const FONT_FAMILY: Record<string, string> = {
  'Inter Tight': 'InterTight_700Bold',
  Inter: 'Inter_600SemiBold',
  'IBM Plex Mono': 'IBMPlexMono_700Bold',
}

export function Stage({
  glbUrl,
  printArea = DEFAULT_PRINT_AREA,
  fabric,
  flat,
}: {
  /** `glb_url` from the product API — drives the real 3D preview. */
  glbUrl?: string | null
  /** The product's print area (config.print_area). */
  printArea?: PrintArea
  /** Cloth preset for the 3D preview — `fabricForProduct(product)`. */
  fabric?: FabricKey
  /** The product's own flat art (config.flat_art); the T-shirt flat when absent. */
  flat?: FlatArt
}) {
  const st = useStudio()
  const t = useT()
  const { s, active, face, surface, artSelected, textSelected } = st

  // The 3D page is created the first time 3D is opened and then kept, hidden,
  // while 2D shows: switching back must not reload the page, the GLB or the
  // textures. A studio that never opens 3D never creates a WebView.
  const opened3d = useRef(false)
  if (surface === '3d') opened3d.current = true

  // What the 3D box shows when 3D is not available: the product's own flat (as in 2D).
  const flatSrc = flat ? flat[face] : undefined
  const photo = flatSrc && !TEE_FLAT.test(flatSrc) ? { uri: flatSrc } : GARMENT_FLAT

  return (
    <View style={styles.stage}>
      {surface === '2d' ? <Flat
        art={active.art}
        text={active.text}
        color={s.color}
        flatSrc={flat ? flat[face] : undefined}
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
        printArea={printArea}
      /> : null}
      {opened3d.current ? (
        <View style={[StyleSheet.absoluteFill, surface === '3d' ? null : styles.hidden]}>
          <Stage3D glbUrl={glbUrl ?? null} printArea={printArea} fabric={fabric} photo={photo} hidden={surface !== '3d'} />
        </View>
      ) : null}
    </View>
  )
}

// ─── 3D ──────────────────────────────────────────────────────────────────────

function Stage3D({
  glbUrl,
  printArea,
  fabric,
  photo,
  hidden,
}: {
  glbUrl: string | null
  printArea: PrintArea
  fabric?: FabricKey
  photo: ImageSourcePropType
  hidden: boolean
}) {
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

  // A colour tap re-bakes three 2048² textures. Of a burst of taps the scene
  // bakes once, 150 ms after the last one, with the last colour (`bake` counts
  // the bursts, so it redraws even when the colour is back where it started).
  // The chips and the 2D stage read s.color directly and answer on the tap.
  const [baked, setBaked] = useState({ color: s.color, n: 0 })
  const seen = useRef(s.color)
  useEffect(() => {
    if (seen.current === s.color) return
    seen.current = s.color
    const id = setTimeout(() => setBaked((b) => ({ color: s.color, n: b.n + 1 })), 150)
    return () => clearTimeout(id)
  }, [s.color])

  // While 2D shows, hold the last design: each edit would otherwise re-bake the
  // textures in the hidden page. The current design is sent when 3D shows again.
  const shown = useRef<SceneDesign | null>(null)
  const design = useMemo(
    () =>
      (hidden && shown.current) ||
      (({ ...toSceneDesign({ ...s, color: baked.color }, cachedSrc), bake: baked.n }) as SceneDesign),
    [s, baked, hidden],
  )
  shown.current = design

  return (
    <View style={styles.preview3d}>
      <Model3D
        key={`${glbUrl ?? 'default'}|${JSON.stringify(printArea)}|${fabric}`}
        glbUrl={glbUrl}
        printArea={printArea}
        fabric={fabric}
        design={design}
        view={face}
        paused={hidden}
        photo={photo}
      />
    </View>
  )
}

// ─── 2D ──────────────────────────────────────────────────────────────────────

function Flat({
  art,
  text,
  color,
  flatSrc,
  artSelected,
  textSelected,
  onSelectArt,
  onSelectText,
  onMoveArt,
  onMoveText,
  onEmptyTap,
  faceLabel,
  printArea,
}: {
  art: ArtLayer | null
  text: TextLayer | null
  color: string
  /** Absolute URL of the product's flat for this face; null = it has none,
   *  undefined = the catalogue has not loaded yet (both show the T-shirt flat). */
  flatSrc: string | null | undefined
  artSelected: boolean
  textSelected: boolean
  onSelectArt: (v: boolean) => void
  onSelectText: (v: boolean) => void
  onMoveArt: (dxPct: number, dyPct: number) => void
  onMoveText: (dxPct: number, dyPct: number) => void
  onEmptyTap: () => void
  faceLabel: string
  printArea: PrintArea
}) {
  const t = useT()
  const [W, setW] = useState(0)
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), [])

  // Print rect in points, from the measured garment box.
  const rect = useMemo(() => flatRect(W, printArea), [W, printArea])

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

  // The product's own flat; the T-shirt flat when it has none or it fails to load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const ownFlat = flatSrc && flatSrc !== failedSrc ? flatSrc : null
  useEffect(() => {
    if (flatSrc !== undefined && !ownFlat) {
      console.warn(`[Stage] no flat image for this product${flatSrc ? ' (load failed)' : ''}; using the T-shirt flat`)
    }
  }, [ownFlat, flatSrc])
  // The tee's flat ships in the bundle (byte-identical to the served one): no download.
  const flatSource = ownFlat && !TEE_FLAT.test(ownFlat) ? { uri: ownFlat } : GARMENT_FLAT

  return (
    <View style={styles.garmentBox} onLayout={onLayout}>
      {/* Garment colour. The flat is white with soft shading and a transparent
          background: the bottom copy is repainted in the colour (tintColor keeps
          only its silhouette), the top copy multiplies its shading over that.
          Outside the garment both are transparent, so the stage stays as it was.
          Both copies are always drawn, White included (white x shade = the flat):
          iOS applies tint mode only when an image arrives, so tintColor must not
          switch between undefined and a colour. Android below 10 has no
          mixBlendMode, where the shade copy would cover the tint: it gets the
          flat-colour silhouette alone. */}
      <View pointerEvents="none" style={styles.garmentLayers}>
        <Image
          source={flatSource}
          style={styles.garment}
          resizeMode="contain"
          tintColor={color}
          onError={() => setFailedSrc(flatSrc ?? null)}
        />
        {BLEND ? <Image source={flatSource} style={[styles.garment, styles.garmentShade]} resizeMode="contain" /> : null}
      </View>

      {W > 0 ? (
        <>
          {/* Print boundary */}
          <View pointerEvents="none" style={[styles.printRect, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}>
            <T style={[mono(7.5, 1, { ls: 0.16, upper: true, color: C.i38 }), styles.printLabel]}>
              {t('st.print', { w: printArea.platen_cm.w, h: printArea.platen_cm.h, face: faceLabel })}
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
              <T style={[mono(12, 1.3, { ls: 0.12, upper: true, color: C.i55, align: 'center' })]}>{t('st.addDesign')}</T>
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
  // The one stage box, shared by 2D and 3D so the stage does not change size
  // when the surface changes. It is the flat garment's square (see below).
  stage: { width: '100%', aspectRatio: 1, maxHeight: '100%' },
  hidden: { opacity: 0, pointerEvents: 'none' },
  // The flat scan is square, so the box that carries every overlay is square
  // too. Width drives it: on a portrait phone the stage is always taller than
  // it is wide, so width is the dimension that runs out first.
  garmentBox: { width: '100%', aspectRatio: 1, maxHeight: '100%' },
  garment: { width: '100%', height: '100%' },
  // The two flat copies blend only with each other, never with the screen behind.
  garmentLayers: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, isolation: 'isolate' },
  garmentShade: { position: 'absolute', left: 0, top: 0, mixBlendMode: 'multiply' },

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
    flex: 1,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.paper,
    overflow: 'hidden',
  },
})

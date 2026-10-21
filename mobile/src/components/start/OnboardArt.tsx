import React from 'react'
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { GARMENT_FLAT } from '../../api/catalog'
import { C, RULE, offset } from '../../theme/tokens'
import { disp, mono } from '../../theme/type'
import { useT } from '../../i18n'
import { ImageTool, Pin, Telegram, TypeTool } from '../icons'
import { T } from '../ui'
import { Truck } from './glyphs'

// The three onboarding pictures (W03–W05), drawn from the app's own pieces — the
// flat garment scan, a product photo, the design system's blocks — so the intro
// shows the real product. Each fills `ArtFrame`: 2px ink, hard shadow, 340 high.

const HOODIE = require('../../../assets/products/hoodie_regular_white_002.jpg')

/** The framed picture. The inner view clips; the shadow belongs to the outer one. */
export function ArtFrame({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.frame}>
      <View style={styles.clip}>{children}</View>
    </View>
  )
}

/** A floating label: 32px, 2px ink, hard-sm (W03 "Matn", W05 "Toshkent · 2–4 kun"). */
function Tag({ icon, children, style }: { icon?: React.ReactNode; children: React.ReactNode; style: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tag, offset(2), style]}>
      {icon}
      <T style={disp(13, 1, {})}>{children}</T>
    </View>
  )
}

/** The small corner label on a half of W04 ("2D" / "3D"). */
function Corner({ children, dark }: { children: string; dark?: boolean }) {
  return (
    <View style={[styles.corner, dark && { backgroundColor: C.ink }]}>
      <T style={disp(13, 16 / 13, { color: dark ? C.paper : C.ink })}>{children}</T>
    </View>
  )
}

/** W03: the flat garment with the three tools floating over it. */
export function ArtStudio() {
  const t = useT()
  return (
    <ArtFrame>
      <Image source={GARMENT_FLAT} style={styles.garment} resizeMode="contain" />
      <View style={styles.sampleText}>
        <T style={{ fontFamily: 'InterTight_800ExtraBold', fontSize: 22, color: C.ink, letterSpacing: -0.5 }}>
          TASHKENT
        </T>
        <View style={styles.sampleBar} />
      </View>
      <Tag style={{ top: 16, left: 14 }} icon={<TypeTool size={16} width={2.4} />}>
        {t('onb.tagText')}
      </Tag>
      <Tag style={{ top: '40%', right: 12 }} icon={<ImageTool size={16} width={2.2} />}>
        {t('onb.tagGraphic')}
      </Tag>
      <Tag
        style={{ bottom: 16, left: 14 }}
        icon={
          <View style={{ flexDirection: 'row', gap: 3 }}>
            <View style={styles.swatchLight} />
            <View style={styles.swatchInk} />
          </View>
        }
      >
        {t('onb.tagColor')}
      </Tag>
    </ArtFrame>
  )
}

/** W04: 2D layout next to a 3D view of the same garment. */
export function ArtPreview() {
  const t = useT()
  return (
    <ArtFrame>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={[styles.half, { borderRightWidth: RULE, borderRightColor: C.ink, backgroundColor: C.white }]}>
          <Image source={GARMENT_FLAT} style={styles.garment} resizeMode="contain" />
          <View style={styles.printRect} />
          <View style={{ position: 'absolute', top: 12, left: 12 }}>
            <Corner>2D</Corner>
          </View>
          <T style={[mono(12, 16 / 12, { color: C.i70, align: 'center' }), styles.caption]}>{t('onb.printSize')}</T>
        </View>
        <View style={[styles.half, { backgroundColor: '#e6e1d5' }]}>
          <Image source={HOODIE} style={styles.fill} resizeMode="cover" />
          <View style={{ position: 'absolute', top: 12, left: 12 }}>
            <Corner dark>3D</Corner>
          </View>
          <View style={styles.degWrap}>
            <T style={[mono(12, 16 / 12, { ls: 0.14, align: 'center' }), styles.deg]}>360°</T>
          </View>
        </View>
      </View>
    </ArtFrame>
  )
}

/** W05: a street grid with the delivery pin, and the two ways in. */
export function ArtDelivery() {
  const t = useT()
  const n = [0, 1, 2, 3, 4, 5, 6]
  return (
    <ArtFrame>
      <View style={[styles.fill, { backgroundColor: C.paper2 }]}>
        {n.map((r) => (
          <View key={`h${r}`} style={[styles.road, { top: `${10 + r * 13}%`, left: 0, right: 0, height: 2 }]} />
        ))}
        {n.map((r) => (
          <View key={`v${r}`} style={[styles.road, { left: `${8 + r * 14}%`, top: 0, bottom: 0, width: 2 }]} />
        ))}
        <View style={[styles.road, { top: '38%', left: '-10%', right: '-10%', height: 5, transform: [{ rotate: '-12deg' }] }]} />
      </View>
      <View style={styles.pin} pointerEvents="none">
        <View style={[styles.pinHead, offset(2)]}>
          <Pin size={24} width={2.2} />
        </View>
        <View style={{ width: 2, height: 18, backgroundColor: C.ink }} />
        <View style={{ width: 8, height: 8, backgroundColor: C.ink }} />
      </View>
      <Tag style={{ top: 16, left: 14 }} icon={<Telegram size={16} color={C.ink} />}>
        {t('onb.chipTelegram')}
      </Tag>
      <Tag style={{ bottom: 16, right: 12 }} icon={<Truck size={16} />}>
        {t('onb.chipDelivery')}
      </Tag>
    </ArtFrame>
  )
}

const styles = StyleSheet.create({
  // marginRight leaves room for the 3px hard shadow inside the page gutter.
  // 340 high as drawn; on a short screen it gives up to 190 before the copy
  // below it would be pushed off.
  frame: {
    height: 340,
    flexShrink: 1,
    minHeight: 190,
    marginRight: 3,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    ...offset(3),
  },
  clip: { flex: 1, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  garment: { position: 'absolute', left: 0, right: 0, top: '6%', height: '80%', width: '100%' },
  half: { flex: 1, overflow: 'hidden' },
  caption: { position: 'absolute', left: 8, right: 8, bottom: 14 },
  // The 3D half is a photo, so its caption sits on a paper chip to stay readable.
  degWrap: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' },
  deg: { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: C.paper, borderWidth: RULE, borderColor: C.ink },

  tag: {
    position: 'absolute',
    minHeight: 32,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  corner: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  swatchLight: { width: 12, height: 12, backgroundColor: C.white, borderWidth: 1.5, borderColor: C.ink },
  swatchInk: { width: 12, height: 12, backgroundColor: C.ink },

  sampleText: { position: 'absolute', left: 0, right: 0, top: '40%', alignItems: 'center', gap: 6 },
  sampleBar: { width: 54, height: 10, backgroundColor: C.coral, borderWidth: 1, borderColor: C.ink },
  printRect: {
    position: 'absolute',
    left: '28%',
    top: '30%',
    width: '44%',
    aspectRatio: 3 / 4,
    borderWidth: RULE,
    borderStyle: 'dashed',
    borderColor: C.coral,
  },

  road: { position: 'absolute', backgroundColor: 'rgba(19,19,17,.12)' },
  pin: { position: 'absolute', left: 0, right: 0, top: '28%', alignItems: 'center' },
  pinHead: {
    width: 48,
    height: 48,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

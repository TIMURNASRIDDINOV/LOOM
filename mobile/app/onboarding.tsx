import React, { useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { C, RULE, offset } from '../src/theme/tokens'
import { body, disp, mono, monoSemi } from '../src/theme/type'
import { Hatch } from '../src/components/ArtPattern'
import { Button, T, Tap, Wordmark } from '../src/components/ui'
import { GARMENT_FLAT } from '../src/api/catalog'
import { ONBOARDING } from '../src/api/market'

export const ONBOARD_KEY = 'loom_onboarded_v1'

const HOODIE = require('../assets/products/hoodie_regular_white_002.jpg')

export default function Onboarding() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [i, setI] = useState(0)
  const slide = ONBOARDING[i]
  const last = i === ONBOARDING.length - 1

  const finish = async (target: '/login' | '/') => {
    await AsyncStorage.setItem(ONBOARD_KEY, '1').catch(() => {})
    router.replace(target)
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.top}>
        <Wordmark size={16.8} />
        <Tap onPress={() => finish('/')} hitSlop={10} style={{ paddingVertical: 12 }}>
          <T style={mono(11, 1, { ls: 0.18, upper: true, color: C.i38 })}>Пропустить</T>
        </Tap>
      </View>

      <View style={styles.middle}>
        <Hatch style={styles.artFrame}>
          {i === 0 ? <ArtStudio /> : i === 1 ? <ArtPreview /> : <ArtDelivery />}
        </Hatch>

        <View>
          <T style={[monoSemi(11, 1.4, { ls: 0.26, upper: true, color: C.deep }), { marginBottom: 14 }]}>
            {slide.kicker}
          </T>
          <T style={[disp(38, 0.98, { ls: -0.035 }), { marginBottom: 14 }]}>{slide.title}</T>
          <T style={body(15, 1.6, { color: C.i55 })}>{slide.body}</T>
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.dots}>
          {ONBOARDING.map((_, n) => (
            <View
              key={n}
              style={{
                width: n === i ? 22 : 8,
                height: 4,
                backgroundColor: n === i ? C.coral : 'rgba(19,19,17,.2)',
              }}
            />
          ))}
        </View>
        <Button
          title={last ? 'Начать' : 'Далее'}
          variant="ink"
          size={12.5}
          vPad={16}
          style={{ paddingHorizontal: 30 }}
          onPress={() => (last ? finish('/login') : setI(i + 1))}
        />
      </View>
    </View>
  )
}

// ─── Slide art ───────────────────────────────────────────────────────────────
// Drawn from the app's own pieces (the flat scan, a product shot, the design
// system's blocks) so the intro shows the real product, not a placeholder.

/** Slide 1: the flat garment with a text layer and the print boundary. */
function ArtStudio() {
  return (
    <View style={styles.fill}>
      <Image source={GARMENT_FLAT} style={styles.fill} resizeMode="contain" />
      <View style={styles.printRect} />
      <View style={styles.sampleText}>
        <T style={{ fontFamily: 'InterTight_800ExtraBold', fontSize: 22, color: C.ink, letterSpacing: -0.5 }}>
          TASHKENT
        </T>
        <View style={styles.sampleBar} />
      </View>
      <View style={[styles.chip, { left: 14, bottom: 14 }]}>
        <T style={mono(8.5, 1, { ls: 0.16, upper: true, color: C.ink })}>текст · графика · цвет</T>
      </View>
    </View>
  )
}

/** Slide 2: 2D ↔ 3D — the flat scan next to a photographed garment. */
function ArtPreview() {
  return (
    <View style={[styles.fill, { flexDirection: 'row', gap: 10, padding: 6 }]}>
      <View style={styles.half}>
        <Image source={GARMENT_FLAT} style={styles.fill} resizeMode="contain" />
        <View style={[styles.chip, { left: 8, top: 8 }]}>
          <T style={mono(8.5, 1, { ls: 0.16, upper: true, color: C.ink })}>2D</T>
        </View>
      </View>
      <View style={[styles.half, offset(3, C.coral)]}>
        <Image source={HOODIE} style={styles.fill} resizeMode="cover" />
        <View style={[styles.chip, { left: 8, top: 8, backgroundColor: C.ink, borderColor: C.ink }]}>
          <T style={mono(8.5, 1, { ls: 0.16, upper: true, color: C.paper })}>3D</T>
        </View>
      </View>
    </View>
  )
}

/** Slide 3: the delivery map — a street grid with the coral pin. */
function ArtDelivery() {
  const rows = [0, 1, 2, 3, 4, 5, 6]
  return (
    <View style={[styles.fill, { backgroundColor: '#ebe8e1', overflow: 'hidden' }]}>
      {rows.map((r) => (
        <View key={`h${r}`} style={[styles.road, { top: `${10 + r * 13}%`, left: 0, right: 0, height: 2 }]} />
      ))}
      {rows.map((r) => (
        <View key={`v${r}`} style={[styles.road, { left: `${8 + r * 14}%`, top: 0, bottom: 0, width: 2 }]} />
      ))}
      <View style={[styles.road, { top: '38%', left: '-10%', right: '-10%', height: 5, transform: [{ rotate: '-12deg' }] }]} />
      <View style={styles.pinShadow} />
      <View style={styles.pin} />
      <View style={[styles.chip, { right: 14, bottom: 14 }]}>
        <T style={mono(8.5, 1, { ls: 0.16, upper: true, color: C.ink })}>Ташкент · 2–4 дня</T>
      </View>
      <View style={[styles.chip, { left: 14, top: 14, backgroundColor: C.telegram, borderColor: C.telegram }]}>
        <T style={mono(8.5, 1, { ls: 0.16, upper: true, color: C.white })}>вход через Telegram</T>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper, paddingHorizontal: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  middle: { flex: 1, minHeight: 0, justifyContent: 'center', gap: 30 },
  artFrame: {
    aspectRatio: 1,
    width: '100%',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    overflow: 'hidden',
  },
  fill: { width: '100%', height: '100%' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dots: { flexDirection: 'row', gap: 6, flex: 1 },

  printRect: {
    position: 'absolute',
    left: '27%',
    top: '30%',
    width: '46%',
    aspectRatio: 3 / 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.i38,
  },
  sampleText: { position: 'absolute', left: 0, right: 0, top: '44%', alignItems: 'center', gap: 6 },
  sampleBar: { width: 54, height: 10, backgroundColor: C.coral, borderWidth: 1, borderColor: C.ink },
  chip: {
    position: 'absolute',
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.ink,
  },
  half: { flex: 1, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, overflow: 'hidden' },

  road: { position: 'absolute', backgroundColor: 'rgba(19,19,17,.12)' },
  pin: {
    position: 'absolute',
    left: '50%',
    top: '44%',
    marginLeft: -12,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderTopWidth: 30,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: C.coral,
  },
  pinShadow: {
    position: 'absolute',
    left: '50%',
    top: '44%',
    marginLeft: -7,
    marginTop: 29,
    width: 14,
    height: 5,
    borderRadius: 7,
    backgroundColor: 'rgba(19,19,17,.25)',
  },
})

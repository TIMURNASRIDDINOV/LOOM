import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Image, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, kicker, mono, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ArtPattern } from '../../src/components/ArtPattern'
import { ArrowUpRight } from '../../src/components/icons'
import { Button, Panel, SectionHead, T, Tap } from '../../src/components/ui'
import { GARMENT_FLAT, fetchProducts, productImage, useAsync } from '../../src/api/catalog'
import { ARTWORKS } from '../../src/api/market'
import { useStudio } from '../../src/state/studio'
import { ONBOARD_KEY } from '../onboarding'

export default function Home() {
  const router = useRouter()
  const { s, layerCount } = useStudio()
  const { data: products } = useAsync(fetchProducts, [])

  // First launch goes through onboarding once, then never again.
  useEffect(() => {
    AsyncStorage.getItem(ONBOARD_KEY)
      .then((seen) => {
        if (!seen) router.replace('/onboarding')
      })
      .catch(() => {})
  }, [router])

  const custom = (products ?? []).filter((p) => p.product_type !== 'ready').slice(0, 4)
  const resumeMeta = `${layerCount ? `${layerCount} ${layerCount === 1 ? 'слой' : 'слоя'}` : 'чистый холст'} · ${s.colorName} · ${s.size}`

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="LOOM" />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <T style={kicker()}>Ташкент · доставка 2–4 дня</T>
          <T style={[disp(38, 0.96, { ls: -0.035 }), { marginTop: 12 }]}>
            Носи <T style={{ color: C.coral }}>/</T>
            {'\n'}то, что ты{'\n'}придумал.
          </T>
        </View>

        {/* Resume card — the studio is the app's centre of gravity. */}
        <View style={{ paddingHorizontal: 18, paddingBottom: 22 }}>
          <Tap onPress={() => router.push('/studio')}>
            <Panel raised style={styles.resume}>
              <View style={styles.resumeThumb}>
                <Image source={GARMENT_FLAT} style={styles.resumeImg} resizeMode="contain" />
              </View>
              <View style={styles.resumeBody}>
                <T style={monoSemi(9.5, 1, { ls: 0.2, upper: true, color: C.coral })}>Продолжить</T>
                <T style={disp(17, 1.1, { ls: -0.02 })} numberOfLines={1}>
                  {s.productName}
                </T>
                <T style={mono(11, 1.4, { color: C.i55 })} numberOfLines={1}>
                  {resumeMeta}
                </T>
              </View>
              <View style={styles.resumeArrow}>
                <ArrowUpRight />
              </View>
            </Panel>
          </Tap>
        </View>

        <View style={{ paddingBottom: 24 }}>
          <SectionHead title="Начать с" action="Каталог →" onAction={() => router.push('/catalog')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {custom.map((p) => (
              <Tap key={p.id} style={styles.railCard} onPress={() => router.push(`/studio?productId=${p.id}`)}>
                <View style={styles.railImgWrap}>
                  <Image source={productImage(p)} style={styles.fill} resizeMode="cover" />
                </View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 8 }}>
                  <T style={disp(13, 1.15)} numberOfLines={1}>
                    {p.name_ru}
                  </T>
                  <T style={[mono(10, 1.2, { color: C.i55 }), { marginTop: 2 }]}>{fmt(p.price)}</T>
                </View>
              </Tap>
            ))}
            {custom.length === 0
              ? [0, 1, 2].map((i) => <View key={i} style={[styles.railCard, styles.railSkeleton]} />)
              : null}
          </ScrollView>
        </View>

        <Marquee />

        <View style={{ paddingTop: 24 }}>
          <SectionHead title="От дизайнеров" action="Все →" onAction={() => router.push('/market')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {ARTWORKS.slice(0, 2).map((a) => (
              <Tap key={a.id} style={styles.artCard} onPress={() => router.push('/market')}>
                <View style={styles.artSwatch}>
                  <ArtPattern {...a.pattern} background={C.white} style={StyleSheet.absoluteFill} />
                  <T
                    style={[
                      mono(8.5, 1.3, { ls: 0.14, upper: true, color: C.i55 }),
                      styles.artSwatchLabel,
                    ]}
                  >
                    {`art · 0${ARTWORKS.indexOf(a) + 1}`}
                  </T>
                </View>
                <View style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                  <T style={disp(13.5, 1.15)}>{a.name}</T>
                  <T style={[mono(10, 1.3, { color: C.i55 }), { marginTop: 3 }]}>
                    {`${a.author} · +${fmt(a.price)}`}
                  </T>
                </View>
              </Tap>
            ))}
          </ScrollView>
        </View>

        {/* Designer pitch — reversed out on ink, the design's one dark block. */}
        <View style={styles.pitch}>
          <T style={disp(29, 0.98, { ls: -0.035, color: C.paper })}>
            Рисуешь?{'\n'}Продавай здесь.
          </T>
          <T style={[body(13.5, 1.6, { color: C.onInk55 }), { marginTop: 12, marginBottom: 20 }]}>
            Загрузите работу — её смогут напечатать на любой вещи. Вы получаете процент с каждой
            продажи.
          </T>
          <Button
            title="Опубликовать работу →"
            variant="ghostInk"
            size={12.5}
            vPad={15}
            style={{ alignSelf: 'flex-start', paddingHorizontal: 26 }}
            onPress={() => router.push('/publish')}
          />
        </View>
      </ScrollView>
    </View>
  )
}

/** The looping wordmark strip. Two identical halves, translated by half width. */
function Marquee() {
  const x = useRef(new Animated.Value(0)).current
  const HALF = 980

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -HALF,
        duration: 24000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [x])

  const unit = (key: string, phrase: string, tail: string) => (
    <View key={key} style={styles.marqueeUnit}>
      <T style={disp(19, 1, { ls: -0.02 })}>{phrase}</T>
      <T style={disp(19, 1, { color: C.coral })}>/</T>
      <T style={mono(10.5, 1, { ls: 0.22, upper: true, color: C.i38 })}>{tail}</T>
    </View>
  )

  return (
    <View style={styles.marquee}>
      <Animated.View style={[styles.marqueeTrack, { transform: [{ translateX: x }] }]}>
        {['a', 'b'].map((half) => (
          <View key={half} style={{ flexDirection: 'row', width: HALF }}>
            {unit(`${half}1`, 'Носи то, что ты придумал', 'LOOM © 2026')}
            {unit(`${half}2`, 'Создано, чтобы носить', 'Tashkent, UZ')}
          </View>
        ))}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 18, paddingTop: 22, paddingBottom: 20 },
  fill: { width: '100%', height: '100%' },

  resume: { flexDirection: 'row', alignItems: 'stretch' },
  resumeThumb: {
    width: 96,
    borderRightWidth: RULE,
    borderRightColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  resumeImg: { width: '100%', height: 68 },
  resumeBody: { flex: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 13, gap: 5 },
  resumeArrow: {
    width: 42,
    borderLeftWidth: RULE,
    borderLeftColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rail: { paddingHorizontal: 18, paddingBottom: 4, gap: 11 },
  railCard: { width: 124, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  railSkeleton: { height: 200, backgroundColor: 'rgba(19,19,17,.04)' },
  railImgWrap: {
    aspectRatio: 4 / 5,
    overflow: 'hidden',
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },

  artCard: { width: 150, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  artSwatch: {
    aspectRatio: 1,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    justifyContent: 'flex-end',
    padding: 8,
  },
  artSwatchLabel: { alignSelf: 'flex-start' },

  marquee: {
    overflow: 'hidden',
    borderTopWidth: RULE,
    borderBottomWidth: RULE,
    borderColor: C.ink,
    paddingVertical: 11,
    backgroundColor: C.paper,
  },
  marqueeTrack: { flexDirection: 'row' },
  marqueeUnit: { flexDirection: 'row', alignItems: 'baseline', gap: 36, paddingRight: 36 },

  pitch: { marginTop: 26, backgroundColor: C.ink, paddingHorizontal: 18, paddingTop: 32, paddingBottom: 34 },
})

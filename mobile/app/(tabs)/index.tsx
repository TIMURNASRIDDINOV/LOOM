import React, { useEffect } from 'react'
import { Image, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { C, HAIR, RULE, fmt, offset } from '../../src/theme/tokens'
import { disp, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Hatch } from '../../src/components/ArtPattern'
import { GarmentFlat } from '../../src/components/GarmentFlat'
import { ArrowUpRight } from '../../src/components/icons'
import { SectionHead, T, Tap } from '../../src/components/ui'
import {
  fetchArtworks,
  fetchProducts,
  productImage,
  useAsync,
  useRefreshOnFocus,
} from '../../src/api/catalog'
import { colorName, productName, useI18n } from '../../src/i18n'
import { useStudio } from '../../src/state/studio'
import { ONBOARD_KEY } from '../onboarding'

const PAD = 18
const GAP = 12

/**
 * The home tab, shaped as an app screen rather than a landing page.
 *
 * It used to open with a marketing hero, an editorial marquee and a dark
 * footer CTA — website furniture. What earns space in a tab you return to
 * daily is your own work first, then things to act on. Navigation is left to
 * the tab bar: repeating Catalogue and Orders as body tiles is the same
 * web-ism in another costume.
 */
export default function Home() {
  const router = useRouter()
  const { t, lang } = useI18n()
  const { s, layerCount } = useStudio()
  const { width } = useWindowDimensions()
  const { data: products } = useAsync(fetchProducts, [])
  const { data: artworks, reload: reloadArtworks } = useAsync(fetchArtworks, [])
  useRefreshOnFocus(reloadArtworks)

  // First launch goes through onboarding once, then never again.
  useEffect(() => {
    AsyncStorage.getItem(ONBOARD_KEY)
      .then((seen) => {
        if (!seen) router.replace('/onboarding')
      })
      .catch(() => {})
  }, [router])

  const custom = (products ?? []).filter((p) => p.product_type !== 'ready').slice(0, 4)
  const layers = layerCount
    ? t(layerCount === 1 ? 'home.layer1' : 'home.layerN', { n: layerCount })
    : t('home.blank')
  const resumeMeta = `${layers} · ${colorName(s.color, t)} · ${s.size}`
  const cardW = (width - PAD * 2 - GAP) / 2

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="LOOM" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36 }}>
        {/* The work in progress — the one thing here that is only here. */}
        <View style={styles.studioWrap}>
          <Tap onPress={() => router.push('/studio')}>
            <View style={[styles.studio, offset(4, C.ink)]}>
              <Hatch style={styles.studioArt}>
                <GarmentFlat scale={1.22} />
              </Hatch>
              <View style={styles.studioFoot}>
                <View style={styles.studioText}>
                  <T style={mono(9.5, 1, { ls: 0.2, upper: true, color: C.coral })}>
                    {layerCount ? t('home.resume') : t('home.startDesign')}
                  </T>
                  <T style={[disp(18, 1.15, { ls: -0.02 }), { marginTop: 6 }]} numberOfLines={1}>
                    {s.productName || t('st.defaultProduct')}
                  </T>
                  <T style={[mono(10.5, 1.4, { color: C.i55 }), { marginTop: 3 }]} numberOfLines={1}>
                    {resumeMeta}
                  </T>
                </View>
                <View style={styles.studioArrow}>
                  <ArrowUpRight />
                </View>
              </View>
            </View>
          </Tap>
        </View>

        <View style={styles.section}>
          <SectionHead
            title={t('home.startWith')}
            action={t('home.catalogLink')}
            onAction={() => router.push('/catalog')}
          />
          <View style={styles.grid}>
            {custom.map((p) => (
              <Tap
                key={p.id}
                style={{ width: cardW }}
                onPress={() => router.push(`/studio?productId=${p.id}`)}
              >
                <View style={styles.gridImg}>
                  <Image source={productImage(p)} style={styles.fill} resizeMode="cover" />
                </View>
                <T style={[disp(14, 1.2, { ls: -0.01 }), styles.cardName]} numberOfLines={1}>
                  {productName(p, lang)}
                </T>
                <T style={mono(10.5, 1.3, { color: C.i55 })}>{fmt(p.price)}</T>
              </Tap>
            ))}
            {custom.length === 0
              ? [0, 1].map((i) => (
                  <View key={i} style={[{ width: cardW }, styles.gridImg, styles.skeleton]} />
                ))
              : null}
          </View>
        </View>

        <View style={styles.section}>
          <SectionHead
            title={t('home.fromDesigners')}
            action={t('home.all')}
            onAction={() => router.push('/market')}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(artworks ?? []).slice(0, 6).map((a) => (
              <Tap key={a.id} style={styles.railCard} onPress={() => router.push('/market')}>
                <Image source={{ uri: a.image_url }} style={styles.artImg} resizeMode="cover" />
                <T style={[disp(14, 1.2, { ls: -0.01 }), styles.cardName]} numberOfLines={1}>
                  {a.title}
                </T>
                <T style={mono(10.5, 1.3, { color: C.i55 })} numberOfLines={1}>
                  {`${a.author}${a.markup > 0 ? ` · +${fmt(a.markup)}` : ''}`}
                </T>
              </Tap>
            ))}
            {(artworks ?? []).length === 0 ? (
              <View style={styles.artEmpty}>
                <T style={mono(9.5, 1.5, { ls: 0.14, upper: true, color: C.i38 })}>{t('home.noArtworks')}</T>
              </View>
            ) : null}
          </ScrollView>
        </View>

        {/* Publishing is not a tab, so it gets the one row that leads to it. */}
        <Tap onPress={() => router.push('/publish')} style={styles.publish}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={disp(17, 1.15, { ls: -0.02, color: C.paper })}>{t('home.publish')}</T>
            <T style={[mono(10.5, 1.4, { color: C.onInk55 }), { marginTop: 4 }]}>
              {t('home.publishHint')}
            </T>
          </View>
          <T style={disp(24, 1, { color: C.coral })}>/</T>
        </Tap>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },

  studioWrap: { paddingHorizontal: PAD, paddingTop: 20 },
  studio: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.paper },
  studioArt: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: C.white,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  studioFoot: { flexDirection: 'row', alignItems: 'stretch' },
  studioText: { flex: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 13 },
  studioArrow: {
    width: 54,
    backgroundColor: C.coral,
    borderLeftWidth: RULE,
    borderLeftColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: { paddingTop: 34 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PAD, gap: GAP },
  gridImg: {
    width: '100%',
    aspectRatio: 4 / 5,
    backgroundColor: C.white,
    borderWidth: HAIR,
    borderColor: C.line,
    overflow: 'hidden',
  },
  skeleton: { backgroundColor: 'rgba(19,19,17,.04)' },

  rail: { paddingHorizontal: PAD, gap: GAP },
  railCard: { width: 152 },
  artImg: { width: '100%', aspectRatio: 1, borderWidth: HAIR, borderColor: C.line },
  cardName: { marginTop: 10, marginBottom: 2 },
  artEmpty: {
    width: 240,
    paddingVertical: 26,
    paddingHorizontal: 16,
    borderWidth: HAIR,
    borderStyle: 'dashed',
    borderColor: C.line,
    justifyContent: 'center',
  },

  publish: {
    marginTop: 40,
    marginHorizontal: PAD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.ink,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
})

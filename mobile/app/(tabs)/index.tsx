import React, { useEffect } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { C, RULE, offset } from '../../src/theme/tokens'
import { body, disp, kicker, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ArrowUpRight } from '../../src/components/icons'
import {
  ArtworkCard,
  Button,
  EmptyState,
  OfflineState,
  Skeleton,
  T,
  Tap,
  isOffline,
} from '../../src/components/ui'
import { LabHero } from '../../src/components/shop/LabHero'
import { Marquee } from '../../src/components/shop/Marquee'
import { ProductCard, ProductGrid, cellStyle } from '../../src/components/shop/ProductCard'
import { SectionHeading } from '../../src/components/shop/SectionHeading'
import {
  GARMENT_FLAT,
  fetchArtworks,
  fetchProducts,
  useAsync,
  useRefreshOnFocus,
} from '../../src/api/catalog'
import { colorName, useI18n } from '../../src/i18n'
import { useLabEnabled } from '../../src/lib/flags'
import { useStudio } from '../../src/state/studio'
import { ONBOARD_KEY } from '../onboarding'

// W09. Blocks, top to bottom: the Lab hero (only while the Lab flag is on),
// the studio resume card, "Start with" (the catalog), the marquee, designers'
// artwork, the designer pitch. With the flag off there is no Lab element.

export default function Home() {
  const router = useRouter()
  const { t } = useI18n()
  const { s, layerCount } = useStudio()
  const lab = useLabEnabled()
  const { data: products, loading, error, reload } = useAsync(fetchProducts, [])
  const { data: artworks, loading: artLoading, error: artError, reload: reloadArtworks } = useAsync(fetchArtworks, [])
  useRefreshOnFocus(reloadArtworks)

  // First launch goes through onboarding once, then never again.
  useEffect(() => {
    AsyncStorage.getItem(ONBOARD_KEY)
      .then((seen) => {
        if (!seen) router.replace('/onboarding')
      })
      .catch(() => {})
  }, [router])

  const all = products ?? []
  const start = all.filter((p) => p.product_type !== 'ready').slice(0, 4)
  const layers = layerCount
    ? t(layerCount === 1 ? 'home.layer1' : 'home.layerN', { n: layerCount })
    : t('home.blank')
  const resumeMeta = `${layers} · ${colorName(s.color, t)} · ${s.size}`

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="LOOM" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {lab ? <LabHero /> : null}

        <View style={styles.block}>
          {/* Resume card — the studio is the app's centre of gravity. */}
          <Tap
            accessibilityRole="button"
            accessibilityLabel={`${t('home.resume')}: ${s.productName || t('st.defaultProduct')}`}
            onPress={() => router.push('/studio')}
            style={[styles.resume, offset(2)]}
          >
            <View style={styles.resumeThumb}>
              <Image source={GARMENT_FLAT} style={{ width: 56, height: 56 }} resizeMode="contain" />
            </View>
            <View style={styles.resumeBody}>
              <T style={mono(12, 16 / 12, { ls: 0.14, upper: true, color: C.deep })}>{t('home.resume')}</T>
              <T style={disp(16, 1.15, { ls: -0.02 })} numberOfLines={1}>
                {s.productName || t('st.defaultProduct')}
              </T>
              <T style={mono(12, 16 / 12, { color: C.i70 })} numberOfLines={1}>
                {resumeMeta}
              </T>
            </View>
            <View style={styles.resumeArrow}>
              <ArrowUpRight color={C.ink} />
            </View>
          </Tap>

          <View style={{ gap: 12 }}>
            <SectionHeading title={t('home.startWith')} action={t('home.catalogLink')} onAction={() => router.push('/catalog')} />
            {error && !products ? (
              isOffline(error) ? (
                <OfflineState onRetry={reload} />
              ) : (
                <EmptyState title={t('catalog.loadFailed')} action={t('common.retry')} onAction={reload} />
              )
            ) : loading && !products ? (
              <ProductGrid muted>
                {[0, 1].map((i) => (
                  <View key={i} style={cellStyle(true)}>
                    <Skeleton height={150} lines={['60%', '85%', '50%']} />
                  </View>
                ))}
              </ProductGrid>
            ) : (
              <ProductGrid>
                {start.map((p) => (
                  <ProductCard key={p.id} product={p} index={all.indexOf(p) + 1} onPress={() => router.push(`/product?id=${p.id}`)} />
                ))}
              </ProductGrid>
            )}
          </View>
        </View>

        <View style={{ marginTop: 24 }}>
          <Marquee
            items={[
              { text: t('home.marqueeA'), tail: 'LOOM © 2026' },
              { text: t('home.marqueeB'), tail: 'Tashkent, UZ' },
            ]}
          />
        </View>

        {/* A failed artwork request hides the rail rather than claim there is none. */}
        {artError && !artworks ? null : (
          <View style={[styles.block, { paddingTop: 24 }]}>
            <SectionHeading title={t('home.fromDesigners')} action={t('home.all')} onAction={() => router.push('/market')} />
            {artLoading && !artworks ? (
              <View style={styles.rail}>
                {[0, 1].map((i) => (
                  <Skeleton key={i} height={150} lines={['70%', '50%']} style={{ width: 150 }} />
                ))}
              </View>
            ) : (artworks ?? []).length === 0 ? (
              <View style={styles.none}>
                <T style={body(14, 21 / 14, { color: C.i70 })}>{t('home.noArtworks')}</T>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.railScroll}
                contentContainerStyle={styles.rail}
              >
                {(artworks ?? []).slice(0, 6).map((a) => (
                  <ArtworkCard
                    key={a.id}
                    artwork={a}
                    style={{ width: 150 }}
                    onPress={() => router.push('/market')}
                    onAuthor={() => router.push(`/designer?handle=${encodeURIComponent(a.author.replace(/^@/, ''))}`)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Designer pitch. */}
        <View style={[styles.pitch, offset(6, C.coral)]}>
          <T style={kicker()}>{t('home.pitchKicker')}</T>
          <T style={disp(26, 1.02, { ls: -0.03 })}>{t('home.pitchTitle')}</T>
          <T style={body(14, 21 / 14, { color: C.i70 })}>{t('home.pitchBody')}</T>
          <Button
            title={t('home.pitchCta')}
            variant="ink"
            style={{ alignSelf: 'flex-start', paddingHorizontal: 18, marginTop: 4 }}
            onPress={() => router.push('/publish')}
          />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: 16, paddingTop: 16, gap: 24 },

  resume: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 72,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  resumeThumb: {
    width: 72,
    borderRightWidth: RULE,
    borderRightColor: C.ink,
    backgroundColor: C.paper2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeBody: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center', gap: 3 },
  resumeArrow: {
    width: 48,
    borderLeftWidth: RULE,
    borderLeftColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },

  railScroll: { marginHorizontal: -16 },
  rail: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingBottom: 4 },
  none: { padding: 16, borderWidth: RULE, borderStyle: 'dashed', borderColor: 'rgba(19,19,17,.4)', backgroundColor: C.white },

  pitch: {
    gap: 10,
    marginTop: 28,
    marginLeft: 16,
    marginRight: 22,
    padding: 16,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
})

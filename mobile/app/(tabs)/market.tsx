import React from 'react'
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Button, SlashTitle, T, Tap } from '../../src/components/ui'
import { fetchArtworks, useAsync, useRefreshOnFocus } from '../../src/api/catalog'
import type { Artwork } from '../../src/api/types'
import { useT } from '../../src/i18n'
import { useAuth } from '../../src/state/auth'
import { useStudio } from '../../src/state/studio'
import { useToast } from '../../src/state/toast'

/**
 * Designer marketplace — approved artwork from `GET /api/artworks`.
 * Tapping a piece loads it into the studio as the active artwork layer.
 */
export default function Market() {
  const router = useRouter()
  const t = useT()
  const { setArt } = useStudio()
  const { flash } = useToast()
  const { isDesigner, signedIn } = useAuth()
  const { data, loading, error, reload } = useAsync(fetchArtworks, [])
  useRefreshOnFocus(reload)

  const items = data ?? []

  const apply = (a: Artwork) => {
    setArt({
      name: a.title,
      uri: a.image_url,
      // The buyer is applying someone else's approved artwork: the order carries
      // the designer's R2 file for the print shop and the artwork id so the
      // sale is credited to them.
      uploadKey: a.image_key,
      artworkId: a.id,
      price: a.markup,
      author: a.author,
    })
    flash(a.markup > 0 ? t('mk.appliedPlus', { title: a.title, price: fmt(a.markup) }) : t('mk.applied', { title: a.title }))
    router.push('/studio')
  }

  return (
    <View style={{ flex: 1 }}>
      <AppBar title={t('bar.design')} />
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={C.coral} />}
      >
        <SlashTitle size={30}>{t('mk.title')}</SlashTitle>
        <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 6, marginBottom: 20 }]}>{t('mk.subtitle')}</T>

        {loading && !data ? (
          <ActivityIndicator color={C.coral} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={{ gap: 16 }}>
            <T style={body(14, 1.6, { color: C.i55 })}>{error.message}</T>
            <Button title={t('common.retry')} variant="ink" size={12.5} vPad={14} onPress={reload} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <T style={[disp(24, 1.1, { ls: -0.02, color: C.coral }), { maxWidth: 280 }]}>{t('mk.emptyTitle')}</T>
            <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 12 }]}>{t('mk.emptyBody')}</T>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((a) => (
              <Tap key={a.id} style={styles.card} onPress={() => apply(a)}>
                <Image source={{ uri: a.image_url }} style={styles.swatch} resizeMode="cover" />
                <View style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                  <T style={disp(13.5, 1.15)} numberOfLines={1}>
                    {a.title}
                  </T>
                  <T
                    style={[mono(10, 1.2, { color: C.deep }), { marginTop: 3, marginBottom: 7 }]}
                    numberOfLines={1}
                    onPress={() => router.push(`/designer?handle=${encodeURIComponent(a.author.replace(/^@/, ''))}`)}
                  >
                    {`${a.author}${a.sold ? ` · ${t('mk.soldN', { n: a.sold })}` : ''}`}
                  </T>
                  <View style={styles.priceChip}>
                    <T style={{ ...mono(10, 1, { ls: 0.08, color: C.white }), fontFamily: 'IBMPlexMono_600SemiBold' }}>
                      {a.markup > 0 ? t('mk.plus', { price: fmt(a.markup) }) : t('common.free')}
                    </T>
                  </View>
                </View>
              </Tap>
            ))}
          </View>
        )}

        <Button
          title={isDesigner ? t('mk.myWorks') : t('mk.become')}
          variant="ink"
          size={12.5}
          vPad={16}
          style={[{ marginTop: 18 }, offset(3, C.ink)]}
          onPress={() => {
            // Publishing is designer-only; an anonymous visitor signs in first.
            if (!signedIn) {
              flash(t('mk.signInToPublish'))
              router.push('/login')
              return
            }
            router.push('/publish')
          }}
        />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  card: {
    width: '47.6%',
    flexGrow: 1,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  swatch: {
    width: '100%',
    aspectRatio: 1,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },
  priceChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: C.coral,
  },
  empty: { paddingVertical: 30 },
})

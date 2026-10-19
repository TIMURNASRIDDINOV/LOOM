import React, { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, mono } from '../../src/theme/type'
import { ArtworkCategories } from '../../src/components/ArtworkCategories'
import { AppBar } from '../../src/components/AppBar'
import { Button, SlashTitle, T, Tap } from '../../src/components/ui'
import { fetchArtworkCategories, fetchArtworkPage, useAsync, useRefreshOnFocus } from '../../src/api/catalog'
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
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const { data, loading, error, reload } = useAsync(() => fetchArtworkPage(categoryId), [categoryId])
  const categories = useAsync(fetchArtworkCategories, [])
  useRefreshOnFocus(categories.reload)
  // Pages are fetched by offset, so the grid is one snapshot: Load-more pages
  // belong to the page-one response they extend (`of`) and drop out in the
  // render that replaces page one. `epoch` counts page-one requests, so a Load
  // more that started before one never lands.
  const [more, setMore] = useState<{ of: object; items: Artwork[]; page: number; total: number } | null>(null)
  const [moreBusy, setMoreBusy] = useState(false)
  const epoch = useRef(0)

  const current = data?.categoryId === categoryId ? data : null
  const extra = current && more?.of === current ? more : null
  const items = current ? [...current.items, ...(extra?.items ?? [])] : []
  const hasExtra = useRef(false)
  hasExtra.current = !!extra
  // Returning to the tab refetches page one only while no extra pages are
  // loaded; otherwise the buyer keeps a consistent list and their place.
  useRefreshOnFocus(useCallback(() => {
    if (hasExtra.current) return
    epoch.current++
    reload()
  }, [reload]))
  const refresh = () => { epoch.current++; reload() }
  const pick = (id: number | null) => {
    if (id === categoryId) return
    epoch.current++
    setMore(null)
    setCategoryId(id)
  }
  const loadMore = async () => {
    if (!current) return
    const of = current
    const at = epoch.current
    setMoreBusy(true)
    try {
      const result = await fetchArtworkPage(of.categoryId, (extra?.page ?? 1) + 1)
      if (at !== epoch.current) return
      // Offset paging repeats a work when the list grows between pages.
      const seen = new Set(items.map((a) => a.id))
      setMore({
        of,
        items: [...(extra?.items ?? []), ...result.items.filter((a) => !seen.has(a.id))],
        page: result.page,
        // An empty page means the list shrank: stop offering more.
        total: result.items.length ? result.total : 0,
      })
    } catch (err) { if (at === epoch.current) flash((err as Error).message) }
    finally { setMoreBusy(false) }
  }

  const apply = (a: Artwork) => {
    setArt({
      name: a.title,
      uri: a.image_url,
      // The buyer is applying someone else's approved artwork: the order carries
      // the designer's R2 file for the print shop and the artwork id so the
      // sale is credited to them.
      uploadKey: a.image_key,
      artworkId: a.id,
      artworkPrice: a.markup,
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
        refreshControl={<RefreshControl refreshing={loading && !!current} onRefresh={refresh} tintColor={C.coral} />}
      >
        <SlashTitle size={30}>{t('mk.title')}</SlashTitle>
        <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 6, marginBottom: 20 }]}>{t('mk.subtitle')}</T>

        <ArtworkCategories categories={categories} value={categoryId} onChange={pick} all />
        {error ? (
          <View style={{ gap: 16 }}>
            <T style={body(14, 1.6, { color: C.i55 })}>{error.message}</T>
            <Button title={t('common.retry')} variant="ink" size={12.5} vPad={14} onPress={refresh} />
          </View>
        ) : !current ? (
          <ActivityIndicator color={C.coral} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <T style={[disp(24, 1.1, { ls: -0.02, color: C.coral }), { maxWidth: 280 }]}>{t(categoryId === null ? 'mk.emptyTitle' : 'cat.empty')}</T>
            {categoryId === null ? <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 12 }]}>{t('mk.emptyBody')}</T> : null}
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

        {current && !loading && !error && items.length < (extra ?? current).total ? <Button
          title={t('cat.more')} onPress={loadMore} loading={moreBusy} variant="outline" /> : null}
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

import React, { useCallback, useRef, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, fmt } from '../../src/theme/tokens'
import { body, disp } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { MarketEmpty } from '../../src/components/market/MarketEmpty'
import {
  ArtworkCard,
  Button,
  ChipRow,
  OfflineState,
  Skeleton,
  T,
  Tap,
  isOffline,
} from '../../src/components/ui'
import { fetchArtworkCategories, fetchArtworkPage, useAsync, useRefreshOnFocus } from '../../src/api/catalog'
import type { Artwork } from '../../src/api/types'
import { useI18n } from '../../src/i18n'
import { goBack } from '../../src/lib/nav'
import { useAuth } from '../../src/state/auth'
import { useStudio } from '../../src/state/studio'
import { useToast } from '../../src/state/toast'

/**
 * Designer marketplace (W37, W38) — approved artwork from `GET /api/artworks`.
 * Tapping a piece loads it into the studio as the active artwork layer.
 */
export default function Market() {
  const router = useRouter()
  const { lang, t } = useI18n()
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
  // more that started before one never lands (and never keeps the button busy).
  const [more, setMore] = useState<{ of: object; items: Artwork[]; page: number; total: number } | null>(null)
  const [moreBusy, setMoreBusy] = useState(false)
  const epoch = useRef(0)

  const current = data?.categoryId === categoryId ? data : null
  const extra = current && more?.of === current ? more : null
  const items = current ? [...current.items, ...(extra?.items ?? [])] : []
  const hasExtra = useRef(false)
  hasExtra.current = !!extra
  const failed = useRef(false)
  failed.current = !!error
  // A new page-one request supersedes any Load more still in flight (LOOM-243).
  const supersede = () => {
    epoch.current++
    setMoreBusy(false)
  }
  // Returning to the tab refetches page one while no extra pages are loaded —
  // or when the last refresh failed — so the buyer keeps a consistent list and
  // their place, yet an error never sticks.
  useRefreshOnFocus(useCallback(() => {
    if (hasExtra.current && !failed.current) return
    supersede()
    reload()
  }, [reload]))
  const refresh = () => { supersede(); reload() }
  const pick = (id: number | null) => {
    if (id === categoryId) return
    supersede()
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
    } catch (err) {
      if (at === epoch.current) flash((err as Error).message)
    } finally {
      if (at === epoch.current) setMoreBusy(false)
    }
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

  // Publishing is designer-only; an anonymous visitor signs in first.
  const publish = () => {
    if (!signedIn) {
      flash(t('mk.signInToPublish'))
      router.push('/login')
      return
    }
    router.push('/publish')
  }
  const cta = isDesigner ? t('mk.myWorks') : t('mk.become')

  const chips = [
    { value: null as number | null, label: t('cat.all') },
    ...(categories.data ?? []).filter((c) => c.active).map((c) => ({ value: c.id as number | null, label: c[`name_${lang}`] })),
  ]
  const emptyAll = !!current && items.length === 0 && categoryId === null

  return (
    <View style={{ flex: 1 }}>
      <AppBar onBack={() => goBack(router)} />
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!current} onRefresh={refresh} tintColor={C.coral} />}
      >
        {emptyAll ? (
          <MarketEmpty cta={cta} onBecome={publish} />
        ) : (
          <>
            <View style={{ gap: 8 }}>
              <T style={disp(30, 1, { ls: -0.035 })}>{t('mk.title')}</T>
              <T style={body(14, 20 / 14, { color: C.i70 })}>{t('mk.subtitle')}</T>
            </View>

            <ChipRow scroll options={chips} value={categoryId} onChange={pick} />

            {!current && error ? (
              isOffline(error) ? (
                <OfflineState onRetry={refresh} />
              ) : (
                <View style={{ gap: 16 }}>
                  <T style={body(14, 1.6, { color: C.i70 })}>{error.message}</T>
                  <Button title={t('common.retry')} variant="ink" onPress={refresh} />
                </View>
              )
            ) : !current ? (
              <View style={styles.grid}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} style={styles.cell} height={140} lines={['70%', '50%']} />
                ))}
              </View>
            ) : items.length === 0 ? (
              <MarketEmpty title={t('cat.empty')} cta={cta} onBecome={publish} />
            ) : (
              <View style={styles.grid}>
                {items.map((a) => (
                  <ArtworkCard
                    key={a.id}
                    artwork={a}
                    style={styles.cell}
                    onPress={() => apply(a)}
                    onAuthor={() => router.push(`/designer?handle=${encodeURIComponent(a.author.replace(/^@/, ''))}`)}
                  />
                ))}
              </View>
            )}

            {current && error ? (
              <Tap accessibilityRole="button" onPress={refresh} style={styles.stale}>
                <T style={body(13, 18 / 13, { color: C.deep })}>{`${error.message} · ${t('common.retry')}`}</T>
              </Tap>
            ) : null}
            {current && !loading && !error && items.length < (extra ?? current).total ? (
              <Button title={t('cat.more')} onPress={loadMore} loading={moreBusy} variant="outline" />
            ) : null}
            {current && items.length > 0 ? <Button title={cta} variant="ink" onPress={publish} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  cell: { width: '48%' },
  stale: { minHeight: 44, justifyContent: 'center' },
})

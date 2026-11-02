import React from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, dispExtra, kicker } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { StatStrip } from '../../src/components/market/works'
import { ArtworkCard, Button, EmptyState, OfflineState, Skeleton, T, isOffline } from '../../src/components/ui'
import { ApiError } from '../../src/api/client'
import { fetchDesigner, useAsync } from '../../src/api/catalog'
import type { Artwork } from '../../src/api/types'
import { useT } from '../../src/i18n'
import { goBack } from '../../src/lib/nav'
import { useStudio } from '../../src/state/studio'
import { useToast } from '../../src/state/toast'

/** A designer's public page (W39) — bio, sales, and every approved work. */
export default function DesignerScreen() {
  const router = useRouter()
  const t = useT()
  const { handle } = useLocalSearchParams<{ handle?: string }>()
  const { setArt } = useStudio()
  const { flash } = useToast()
  const { data: loaded, loading, error, reload } = useAsync(
    () => (handle ? fetchDesigner(handle) : Promise.reject(new Error(t('dz.notGiven')))),
    [handle],
  )

  const apply = (a: Artwork) => {
    setArt({
      name: a.title,
      uri: a.image_url,
      uploadKey: a.image_key,
      artworkId: a.id,
      artworkPrice: a.markup,
      price: a.markup,
      author: a.author,
    })
    flash(a.markup > 0 ? t('mk.appliedPlus', { title: a.title, price: fmt(a.markup) }) : t('mk.applied', { title: a.title }))
    router.push('/studio')
  }

  // The tab stays mounted, so a different handle must not show the last designer.
  const data = loaded && handle && loaded.handle.toLowerCase() === `@${handle.replace(/^@/, '').toLowerCase()}` ? loaded : null
  const since = data ? new Date(data.since).getFullYear() : null
  // An unknown handle is a 404, not a failure to retry.
  const missing = !handle || (error instanceof ApiError && error.status === 404)

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="" onBack={() => goBack(router, '/market')} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {loading && !data ? (
          <View style={styles.grid}>
            {[0, 1].map((i) => (
              <Skeleton key={i} style={styles.cell} height={124} lines={['70%', '50%']} />
            ))}
          </View>
        ) : missing ? (
          <EmptyState title={t('dz.notFound')} action={t('common.back')} onAction={() => goBack(router, '/market')} />
        ) : error || !data ? (
          isOffline(error) ? (
            <OfflineState onRetry={reload} />
          ) : (
            <View style={{ gap: 16 }}>
              <T style={body(14, 1.6, { color: C.i70 })}>{error?.message ?? t('dz.notFound')}</T>
              <Button title={t('common.retry')} variant="ink" onPress={reload} />
            </View>
          )
        ) : (
          <>
            <View style={{ gap: 10 }}>
              <T style={kicker(12)}>{t('dz.kicker')}</T>
              <View style={styles.identity}>
                <View style={[styles.avatar, offset(3, C.coral)]}>
                  {data.avatar_url ? (
                    <Image source={{ uri: data.avatar_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <T style={dispExtra(30, 1)}>
                      {(data.name ?? data.handle.replace('@', '')).charAt(0).toUpperCase()}
                      <T style={{ color: C.coral }}>/</T>
                    </T>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <T style={disp(28, 1, { ls: -0.03 })} numberOfLines={1}>
                    {data.handle}
                  </T>
                  {data.bio || data.name ? (
                    <T style={body(14, 20 / 14, { color: C.i70 })} numberOfLines={3}>
                      {data.bio ?? data.name}
                    </T>
                  ) : null}
                </View>
              </View>
            </View>

            <StatStrip
              items={[
                { label: t('dz.works'), value: String(data.works.length) },
                { label: t('dz.sold'), value: String(data.units_sold) },
                { label: t('dz.since'), value: since ? String(since) : '—' },
              ]}
            />

            {data.works.length === 0 ? (
              <EmptyState title={t('dz.noWorks')} />
            ) : (
              <View style={styles.grid}>
                {data.works.map((a) => (
                  <ArtworkCard key={a.id} artwork={a} style={styles.cell} onPress={() => apply(a)} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24, gap: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 72,
    height: 72,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  cell: { width: '48%' },
})

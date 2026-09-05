import React from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { C, RULE, fmt } from '../../src/theme/tokens'
import { body, disp, kicker, mono, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ChevronLeft } from '../../src/components/icons'
import { Button, T, Tap } from '../../src/components/ui'
import { fetchDesigner, useAsync } from '../../src/api/catalog'
import type { Artwork } from '../../src/api/types'
import { useT } from '../../src/i18n'
import { goBack } from '../../src/lib/nav'
import { useStudio } from '../../src/state/studio'
import { useToast } from '../../src/state/toast'

/** A designer's public page — bio, sales, and every approved work. */
export default function DesignerScreen() {
  const router = useRouter()
  const t = useT()
  const { handle } = useLocalSearchParams<{ handle?: string }>()
  const { setArt } = useStudio()
  const { flash } = useToast()
  const { data, loading, error, reload } = useAsync(
    () => (handle ? fetchDesigner(handle) : Promise.reject(new Error(t('dz.notGiven')))),
    [handle],
  )

  const apply = (a: Artwork) => {
    setArt({
      name: a.title,
      uri: a.image_url,
      uploadKey: a.image_key,
      artworkId: a.id,
      price: a.markup,
      author: a.author,
    })
    flash(a.markup > 0 ? t('mk.appliedPlus', { title: a.title, price: fmt(a.markup) }) : t('mk.applied', { title: a.title }))
    router.push('/studio')
  }

  const since = data ? new Date(data.since).getFullYear() : null

  return (
    <View style={{ flex: 1 }}>
      <AppBar title={t('bar.design')} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Tap style={styles.back} onPress={() => goBack(router, '/market')}>
          <ChevronLeft size={13} width={2.4} color={C.i55} />
          <T style={mono(10.5, 1, { ls: 0.16, upper: true, color: C.i55 })}>{t('common.back')}</T>
        </Tap>

        {loading ? (
          <ActivityIndicator color={C.coral} style={{ marginTop: 40 }} />
        ) : error || !data ? (
          <View style={{ gap: 16 }}>
            <T style={body(14, 1.6, { color: C.i55 })}>{error?.message ?? t('dz.notFound')}</T>
            <Button title={t('common.retry')} variant="ink" size={12.5} vPad={14} onPress={reload} />
          </View>
        ) : (
          <>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                {data.avatar_url ? (
                  <Image source={{ uri: data.avatar_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <T style={{ fontFamily: 'InterTight_800ExtraBold', fontSize: 22, color: C.white }}>
                    {(data.name ?? data.handle.replace('@', '')).charAt(0).toUpperCase()}
                  </T>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={kicker(10)}>{t('dz.kicker')}</T>
                <T style={[disp(24, 1.05, { ls: -0.03 }), { marginTop: 4 }]} numberOfLines={1}>
                  {data.handle}
                </T>
                {data.name ? (
                  <T style={[mono(11, 1.3, { color: C.i55 }), { marginTop: 2 }]} numberOfLines={1}>
                    {data.name}
                  </T>
                ) : null}
              </View>
            </View>

            {data.bio ? <T style={[body(14, 1.6, { color: C.i70 }), { marginBottom: 16 }]}>{data.bio}</T> : null}

            <View style={styles.stats}>
              <Stat label={t('dz.works')} value={String(data.works.length)} />
              <Stat label={t('dz.sold')} value={String(data.units_sold)} />
              <Stat label={t('dz.since')} value={since ? String(since) : '—'} />
            </View>

            {data.works.length === 0 ? (
              <T style={body(13.5, 1.6, { color: C.i55 })}>{t('dz.noWorks')}</T>
            ) : (
              <View style={styles.grid}>
                {data.works.map((a) => (
                  <Tap key={a.id} style={styles.card} onPress={() => apply(a)}>
                    <Image source={{ uri: a.image_url }} style={styles.swatch} resizeMode="cover" />
                    <View style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                      <T style={disp(13.5, 1.15)} numberOfLines={1}>
                        {a.title}
                      </T>
                      <View style={[styles.priceChip, { marginTop: 7 }]}>
                        <T style={{ ...monoSemi(10, 1, { ls: 0.08, color: C.white }) }}>
                          {a.markup > 0 ? t('mk.plus', { price: fmt(a.markup) }) : t('common.free')}
                        </T>
                      </View>
                    </View>
                  </Tap>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <T style={monoSemi(9, 1, { ls: 0.16, upper: true, color: C.i55 })}>{label}</T>
      <T style={[disp(20, 1, { ls: -0.03 }), { marginTop: 4 }]}>{value}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  avatar: {
    width: 60,
    height: 60,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  stat: { flex: 1, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, padding: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  card: { width: '47.6%', flexGrow: 1, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  swatch: { width: '100%', aspectRatio: 1, borderBottomWidth: RULE, borderBottomColor: C.ink },
  priceChip: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 5, backgroundColor: C.coral },
})

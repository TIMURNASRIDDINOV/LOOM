import React from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Button, SlashTitle, T, Tap } from '../../src/components/ui'
import { fetchArtworks, useAsync } from '../../src/api/catalog'
import type { Artwork } from '../../src/api/types'
import { useAuth } from '../../src/state/auth'
import { useStudio } from '../../src/state/studio'
import { useToast } from '../../src/state/toast'

/**
 * Designer marketplace — approved artwork from `GET /api/artworks`.
 * Tapping a piece loads it into the studio as the active artwork layer.
 */
export default function Market() {
  const router = useRouter()
  const { setArt } = useStudio()
  const { flash } = useToast()
  const { isDesigner, signedIn } = useAuth()
  const { data, loading, error, reload } = useAsync(fetchArtworks, [])

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
    flash(a.markup > 0 ? `${a.title} примерена · +${fmt(a.markup)} сум` : `${a.title} примерена`)
    router.push('/studio')
  }

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="ДИЗАЙН" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <SlashTitle size={30}>Работы дизайнеров</SlashTitle>
        <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 6, marginBottom: 20 }]}>
          Выберите графику — примерим её на любую вещь в студии.
        </T>

        {loading ? (
          <ActivityIndicator color={C.coral} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={{ gap: 16 }}>
            <T style={body(14, 1.6, { color: C.i55 })}>{error.message}</T>
            <Button title="Повторить" variant="ink" size={12.5} vPad={14} onPress={reload} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <T style={[disp(24, 1.1, { ls: -0.02, color: C.coral }), { maxWidth: 280 }]}>
              Здесь пока пусто. Станьте первым дизайнером.
            </T>
            <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 12 }]}>
              Работы появляются после проверки модератором.
            </T>
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
                    {`${a.author}${a.sold ? ` · ${a.sold} прод.` : ''}`}
                  </T>
                  <View style={styles.priceChip}>
                    <T
                      style={{
                        ...mono(10, 1, { ls: 0.08, color: C.white }),
                        fontFamily: 'IBMPlexMono_600SemiBold',
                      }}
                    >
                      {a.markup > 0 ? `+${fmt(a.markup)} сум` : 'бесплатно'}
                    </T>
                  </View>
                </View>
              </Tap>
            ))}
          </View>
        )}

        <Button
          title={isDesigner ? 'Мои работы' : 'Стать дизайнером'}
          variant="ink"
          size={12.5}
          vPad={16}
          style={[{ marginTop: 18 }, offset(3, C.ink)]}
          onPress={() => {
            // Publishing is designer-only; an anonymous visitor signs in first.
            if (!signedIn) {
              flash('Войдите, чтобы публиковать работы')
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

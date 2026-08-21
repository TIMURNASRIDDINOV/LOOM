import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ArtPattern } from '../../src/components/ArtPattern'
import { Button, SlashTitle, T, Tap } from '../../src/components/ui'
import { ARTWORKS } from '../../src/api/market'
import { useStudio } from '../../src/state/studio'
import { useToast } from '../../src/state/toast'

/** Designer marketplace. Artwork is mock data — see `src/api/market.ts`. */
export default function Market() {
  const router = useRouter()
  const { setArt } = useStudio()
  const { flash } = useToast()

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="ДИЗАЙН" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <SlashTitle size={30}>Работы дизайнеров</SlashTitle>
        <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 6, marginBottom: 20 }]}>
          Выберите графику — примерим её на любую вещь в студии.
        </T>

        <View style={styles.grid}>
          {ARTWORKS.map((a) => (
            <Tap
              key={a.id}
              style={styles.card}
              onPress={() => {
                setArt({
                  name: a.name,
                  uri: null,
                  uploadKey: null,
                  price: a.price,
                  author: a.author,
                  pattern: { angle: a.pattern.angle, color: a.pattern.color, gap: a.pattern.gap },
                })
                flash(`${a.name} примерена · +${fmt(a.price)} сум`)
                router.push('/studio')
              }}
            >
              <ArtPattern {...a.pattern} background={C.white} style={styles.swatch} />
              <View style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                <T style={disp(13.5, 1.15)} numberOfLines={1}>
                  {a.name}
                </T>
                <T style={[mono(10, 1.2, { color: C.i55 }), { marginTop: 3, marginBottom: 7 }]}>
                  {a.author}
                </T>
                <View style={styles.priceChip}>
                  <T style={{ ...mono(10, 1, { ls: 0.08, color: C.white }), fontFamily: 'IBMPlexMono_600SemiBold' }}>
                    {`+${fmt(a.price)} сум`}
                  </T>
                </View>
              </View>
            </Tap>
          ))}
        </View>

        <Button
          title="Опубликовать свою работу"
          variant="ink"
          size={12.5}
          vPad={16}
          style={[{ marginTop: 18 }, offset(3, C.ink)]}
          onPress={() => router.push('/publish')}
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
  swatch: { aspectRatio: 1, borderBottomWidth: RULE, borderBottomColor: C.ink },
  priceChip: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 5, backgroundColor: C.coral },
})

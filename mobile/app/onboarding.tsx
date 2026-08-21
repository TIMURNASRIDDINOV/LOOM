import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { C, RULE } from '../src/theme/tokens'
import { body, disp, mono, monoSemi } from '../src/theme/type'
import { Hatch } from '../src/components/ArtPattern'
import { Button, T, Tap, Wordmark } from '../src/components/ui'
import { ONBOARDING } from '../src/api/market'

export const ONBOARD_KEY = 'loom_onboarded_v1'

export default function Onboarding() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [i, setI] = useState(0)
  const slide = ONBOARDING[i]
  const last = i === ONBOARDING.length - 1

  const finish = async (target: '/login' | '/') => {
    await AsyncStorage.setItem(ONBOARD_KEY, '1').catch(() => {})
    router.replace(target)
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.top}>
        <Wordmark size={16.8} />
        <Tap onPress={() => finish('/')} hitSlop={10} style={{ paddingVertical: 12 }}>
          <T style={mono(11, 1, { ls: 0.18, upper: true, color: C.i38 })}>Пропустить</T>
        </Tap>
      </View>

      <View style={styles.middle}>
        <Hatch style={styles.artFrame}>
          <T style={mono(10.5, 1.7, { ls: 0.16, upper: true, color: C.i38, align: 'center' })}>
            {slide.art}
          </T>
        </Hatch>

        <View>
          <T style={[monoSemi(11, 1.4, { ls: 0.26, upper: true, color: C.deep }), { marginBottom: 14 }]}>
            {slide.kicker}
          </T>
          <T style={[disp(38, 0.98, { ls: -0.035 }), { marginBottom: 14 }]}>{slide.title}</T>
          <T style={body(15, 1.6, { color: C.i55 })}>{slide.body}</T>
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.dots}>
          {ONBOARDING.map((_, n) => (
            <View
              key={n}
              style={{
                width: n === i ? 22 : 8,
                height: 4,
                backgroundColor: n === i ? C.coral : 'rgba(19,19,17,.2)',
              }}
            />
          ))}
        </View>
        <Button
          title={last ? 'Начать' : 'Далее'}
          variant="ink"
          size={12.5}
          vPad={16}
          style={{ paddingHorizontal: 30 }}
          onPress={() => (last ? finish('/login') : setI(i + 1))}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper, paddingHorizontal: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  middle: { flex: 1, minHeight: 0, justifyContent: 'center', gap: 30 },
  artFrame: {
    aspectRatio: 1,
    width: '100%',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dots: { flexDirection: 'row', gap: 6, flex: 1 },
})

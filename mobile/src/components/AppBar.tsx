import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { C, RULE } from '../theme/tokens'
import { monoBold } from '../theme/type'
import { Cart, Search } from './icons'
import { T, Tap, Wordmark } from './ui'
import { useCart } from '../state/cart'

/**
 * The single top bar shared by every tabbed screen: wordmark-as-title on the
 * left, search and cart on the right, sitting on a 1.5px rule.
 */
export function AppBar({ title }: { title: string }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { count } = useCart()

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      <Wordmark text={title} />
      <View style={styles.actions}>
        <Tap style={styles.iconBtn} onPress={() => router.push('/market')} hitSlop={6}>
          <Search />
        </Tap>
        <Tap style={styles.iconBtn} onPress={() => router.push('/cart')} hitSlop={6}>
          <Cart />
          {count > 0 ? (
            <View style={styles.badge}>
              <T style={monoBold(10, 1, { color: C.white })}>{String(count)}</T>
            </View>
          ) : null}
        </Tap>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    backgroundColor: C.paper,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  iconBtn: {
    width: 38,
    height: 38,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    backgroundColor: C.coral,
    borderWidth: 1,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
// expo-router 57 vendors react-navigation rather than depending on it, so the
// tab-bar prop types live under its own build path.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, RULE, offset } from '../../src/theme/tokens'
import { dispExtra, monoSemi } from '../../src/theme/type'
import { T, Tap, Toast } from '../../src/components/ui'
import { useToast } from '../../src/state/toast'

// Four labelled tabs with the coral "/" studio button lifted out of the middle.
// The studio is a full-screen route rather than a tab — it owns the whole
// device and has no bottom bar of its own.
const TABS: { name: string; label: string }[] = [
  { name: 'index', label: 'Главная' },
  { name: 'catalog', label: 'Каталог' },
  { name: 'orders', label: 'Заказы' },
  { name: 'account', label: 'Профиль' },
]

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const visible = state.routes
    .map((r, i) => ({ route: r, index: i }))
    .filter(({ route }) => TABS.some((t) => t.name === route.name))

  const cell = (entry: (typeof visible)[number] | undefined, label: string) => {
    if (!entry) return null
    const focused = state.index === entry.index
    return (
      <Tap
        key={entry.route.key}
        style={[styles.tab, { borderTopColor: focused ? C.coral : 'transparent' }]}
        onPress={() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: entry.route.key,
            canPreventDefault: true,
          })
          if (!focused && !event.defaultPrevented) navigation.navigate(entry.route.name)
        }}
      >
        <T style={monoSemi(9, 1, { ls: 0.16, upper: true, color: focused ? C.ink : C.i38 })}>
          {label}
        </T>
      </Tap>
    )
  }

  const find = (name: string) => visible.find((v) => v.route.name === name)

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      {cell(find('index'), 'Главная')}
      {cell(find('catalog'), 'Каталог')}
      <View style={styles.fabSlot}>
        <Tap haptic style={[styles.fab, offset(2, C.ink)]} onPress={() => router.push('/studio')}>
          <T style={dispExtra(30, 1, { color: C.white })}>/</T>
        </Tap>
      </View>
      {cell(find('orders'), 'Заказы')}
      {cell(find('account'), 'Профиль')}
    </View>
  )
}

export default function TabsLayout() {
  const { message } = useToast()

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: C.paper },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Главная' }} />
        <Tabs.Screen name="catalog" options={{ title: 'Каталог' }} />
        <Tabs.Screen name="orders" options={{ title: 'Заказы' }} />
        <Tabs.Screen name="account" options={{ title: 'Профиль' }} />
        {/* Reached from the bar and from links, not from the tab strip. */}
        <Tabs.Screen name="cart" options={{ href: null }} />
        <Tabs.Screen name="checkout" options={{ href: null }} />
        <Tabs.Screen name="market" options={{ href: null }} />
        <Tabs.Screen name="publish" options={{ href: null }} />
        <Tabs.Screen name="product" options={{ href: null }} />
      </Tabs>
      <Toast message={message} />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: RULE,
    borderTopColor: C.ink,
    backgroundColor: C.paper,
  },
  tab: {
    flex: 1,
    borderTopWidth: 2,
    paddingTop: 13,
    paddingBottom: 15,
    paddingHorizontal: 2,
    marginTop: -RULE,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  fabSlot: {
    flex: 1.1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  fab: {
    width: 56,
    height: 56,
    marginTop: -20,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 3,
  },
})

import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
// expo-router 57 vendors react-navigation rather than depending on it, so the
// tab-bar prop types live under its own build path.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, RULE, offset } from '../../src/theme/tokens'
import { dispExtra, monoSemi } from '../../src/theme/type'
import { BoxIcon, GridIcon, HomeIcon, UserIcon } from '../../src/components/icons'
import { T, Tap, Toast } from '../../src/components/ui'
import { useToast } from '../../src/state/toast'

// Four labelled tabs with the coral "/" studio button lifted out of the middle.
// The studio is a full-screen route rather than a tab — it owns the whole
// device and has no bottom bar of its own.
type TabDef = { name: string; label: string; Icon: React.ComponentType<{ size?: number; color?: string }> }

const TABS: TabDef[] = [
  { name: 'index', label: 'Главная', Icon: HomeIcon },
  { name: 'catalog', label: 'Каталог', Icon: GridIcon },
  { name: 'orders', label: 'Заказы', Icon: BoxIcon },
  { name: 'account', label: 'Профиль', Icon: UserIcon },
]

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const visible = state.routes
    .map((r, i) => ({ route: r, index: i }))
    .filter(({ route }) => TABS.some((t) => t.name === route.name))

  // Each tab is an icon over a label, with a 3px coral cap on the active one.
  // The label alone was 9px mono at 38% opacity, which read as disabled text.
  const cell = (entry: (typeof visible)[number] | undefined, tab: TabDef) => {
    if (!entry) return null
    const focused = state.index === entry.index
    const { Icon } = tab
    return (
      <Tap
        key={entry.route.key}
        haptic
        style={styles.tab}
        onPress={() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: entry.route.key,
            canPreventDefault: true,
          })
          if (!focused && !event.defaultPrevented) navigation.navigate(entry.route.name)
        }}
      >
        <View style={[styles.cap, focused && styles.capOn]} />
        <Icon size={21} color={focused ? C.ink : 'rgba(19,19,17,.5)'} />
        <T
          style={monoSemi(9, 1, {
            ls: 0.14,
            upper: true,
            color: focused ? C.ink : 'rgba(19,19,17,.5)',
          })}
        >
          {tab.label}
        </T>
      </Tap>
    )
  }

  const find = (name: string) => visible.find((v) => v.route.name === name)

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      {cell(find('index'), TABS[0])}
      {cell(find('catalog'), TABS[1])}
      <View style={styles.fabSlot}>
        <Tap haptic style={[styles.fab, offset(2, C.ink)]} onPress={() => router.push('/studio')}>
          <T style={dispExtra(30, 1, { color: C.white })}>/</T>
        </Tap>
      </View>
      {cell(find('orders'), TABS[2])}
      {cell(find('account'), TABS[3])}
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
        <Tabs.Screen name="designer" options={{ href: null }} />
        <Tabs.Screen name="profile-edit" options={{ href: null }} />
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
    paddingTop: 9,
    paddingBottom: 10,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5,
  },
  // Sits on top of the bar's own rule, so the active tab looks notched into it.
  cap: {
    position: 'absolute',
    top: -RULE,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'transparent',
  },
  capOn: { backgroundColor: C.coral },
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

import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
// expo-router 57 vendors react-navigation rather than depending on it, so the
// tab-bar prop types live under its own build path.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, F, RULE, offset } from '../../src/theme/tokens'
import { dispExtra } from '../../src/theme/type'
import { BoxIcon, GridIcon, HomeIcon, UserIcon } from '../../src/components/icons'
import { T, Tap, Toast } from '../../src/components/ui'
import { useT } from '../../src/i18n'
import type { StringKey } from '../../src/i18n/strings'
import { useToast } from '../../src/state/toast'

// Four labelled tabs with the accent "/" studio button lifted out of the
// middle (TabBar artboard). The studio is a full-screen route rather than a
// tab — it owns the whole device and has no bottom bar of its own.
type TabDef = { name: string; label: StringKey; Icon: React.ComponentType<{ size?: number; color?: string }> }

const TABS: TabDef[] = [
  { name: 'index', label: 'tab.home', Icon: HomeIcon },
  { name: 'catalog', label: 'tab.catalog', Icon: GridIcon },
  { name: 'orders', label: 'tab.orders', Icon: BoxIcon },
  { name: 'account', label: 'tab.account', Icon: UserIcon },
]

// The bar shows on browsing screens only. Product, cart, checkout, publish,
// profile edit and order detail carry their own bottom actions (PRD-210 R-2).
const WITH_BAR = new Set(['index', 'catalog', 'orders', 'account', 'market', 'designer'])

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const t = useT()
  if (!WITH_BAR.has(state.routes[state.index]?.name ?? '')) return null

  // Each tab is an icon over a label, with a 3px accent cap on the active one.
  const cell = (tab: TabDef) => {
    const index = state.routes.findIndex((r) => r.name === tab.name)
    const route = state.routes[index]
    if (!route) return null
    const focused = state.index === index
    const { Icon } = tab
    return (
      <Tap
        key={route.key}
        haptic
        accessibilityRole="tab"
        accessibilityLabel={t(tab.label)}
        accessibilityState={{ selected: focused }}
        style={styles.tab}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name)
        }}
      >
        <View style={[styles.cap, focused && styles.capOn]} />
        <Icon size={24} color={focused ? C.ink : C.inactive} />
        <T style={[styles.label, focused ? styles.labelOn : null]} numberOfLines={1}>
          {t(tab.label)}
        </T>
      </Tap>
    )
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {cell(TABS[0])}
      {cell(TABS[1])}
      <View style={styles.fabSlot}>
        <Tap
          haptic
          accessibilityRole="button"
          accessibilityLabel={t('tab.studio')}
          style={[styles.fab, offset(2, C.ink)]}
          onPress={() => router.push('/studio')}
        >
          <T style={dispExtra(30, 1, { color: C.ink })}>/</T>
        </Tap>
      </View>
      {cell(TABS[2])}
      {cell(TABS[3])}
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
        <Tabs.Screen name="index" />
        <Tabs.Screen name="catalog" />
        <Tabs.Screen name="orders" />
        <Tabs.Screen name="account" />
        {/* Reached from the bar and from links, not from the tab strip. */}
        <Tabs.Screen name="cart" options={{ href: null }} />
        <Tabs.Screen name="checkout" options={{ href: null }} />
        <Tabs.Screen name="market" options={{ href: null }} />
        <Tabs.Screen name="publish" options={{ href: null }} />
        <Tabs.Screen name="designer" options={{ href: null }} />
        <Tabs.Screen name="profile-edit" options={{ href: null }} />
        <Tabs.Screen name="product" options={{ href: null }} />
        <Tabs.Screen name="order" options={{ href: null }} />
      </Tabs>
      <Toast message={message} />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    borderTopWidth: RULE,
    borderTopColor: C.ink,
    backgroundColor: C.paper,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    paddingTop: 9,
    paddingHorizontal: 2,
    alignItems: 'center',
    gap: 4,
  },
  // Sits on top of the bar's own rule, so the active tab looks notched into it.
  cap: {
    position: 'absolute',
    top: -RULE,
    left: 6,
    right: 6,
    height: 3,
    backgroundColor: 'transparent',
  },
  capOn: { backgroundColor: C.coral },
  label: { fontFamily: F.displaySemi, fontSize: 12, lineHeight: 16, color: C.i70 },
  labelOn: { fontFamily: F.displayBold, color: C.ink },
  fabSlot: { flex: 1, alignItems: 'center' },
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

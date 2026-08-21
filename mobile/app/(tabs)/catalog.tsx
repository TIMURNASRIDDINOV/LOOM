import React, { useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, fmt, noShadow, offset } from '../../src/theme/tokens'
import { body, disp, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Button, T, Tap } from '../../src/components/ui'
import { fetchProducts, invalidateProducts, productImage, useAsync } from '../../src/api/catalog'
import type { Product } from '../../src/api/types'
import { useToast } from '../../src/state/toast'

type Tab = 'all' | 'custom' | 'ready'

export default function Catalog() {
  const router = useRouter()
  const { flash } = useToast()
  const [tab, setTab] = useState<Tab>('all')
  const { data, loading, error, reload } = useAsync(fetchProducts, [])
  const retry = () => {
    invalidateProducts()
    reload()
  }

  const products = data ?? []
  const custom = products.filter((p) => p.product_type !== 'ready')
  const ready = products.filter((p) => p.product_type === 'ready')

  const openProduct = (p: Product) => {
    if (p.product_type === 'ready') {
      // A ready design is bought as-is — it goes to the cart from the catalog,
      // not through the studio.
      router.push(`/product?id=${p.id}`)
    } else {
      router.push(`/studio?productId=${p.id}`)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="КАТАЛОГ" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.tabs}>
          <CatTab label="Все" count={products.length} active={tab === 'all'} onPress={() => setTab('all')} flex={1} />
          <CatTab label="Кастом" count={custom.length} active={tab === 'custom'} onPress={() => setTab('custom')} flex={1.5} />
          <CatTab label="Готовые" count={ready.length} active={tab === 'ready'} onPress={() => setTab('ready')} flex={1.5} />
        </View>

        {loading ? (
          <View style={{ paddingVertical: 60, alignItems: 'center' }}>
            <ActivityIndicator color={C.coral} />
          </View>
        ) : error ? (
          <View style={{ paddingVertical: 40, gap: 16 }}>
            <T style={body(14, 1.6, { color: C.i55 })}>{error.message}</T>
            <Button title="Повторить" variant="ink" size={12.5} vPad={14} onPress={retry} />
          </View>
        ) : (
          <>
            {tab !== 'ready' ? (
              <Section title="Кастомизация" note="дизайн в студии" items={custom} onPick={openProduct} />
            ) : null}
            {tab !== 'custom' ? (
              <View style={{ marginTop: tab === 'all' ? 26 : 0 }}>
                <Section title="Готовые дизайны" note="выберите размер" items={ready} onPick={openProduct} />
              </View>
            ) : null}
            {products.length === 0 ? (
              <T style={[body(14, 1.6, { color: C.i55 }), { paddingVertical: 40 }]}>
                Каталог пока пуст.
              </T>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function CatTab({
  label,
  count,
  active,
  onPress,
  flex,
}: {
  label: string
  count: number
  active: boolean
  onPress: () => void
  flex: number
}) {
  return (
    <Tap
      haptic
      onPress={onPress}
      style={[
        styles.catTab,
        { flex, backgroundColor: active ? C.ink : C.white },
        active ? offset(2, C.coral) : noShadow,
      ]}
    >
      <T style={disp(10.5, 1, { ls: 0.14, upper: true, color: active ? C.paper : C.i55 })}>
        {label}{' '}
        <T style={{ fontSize: 7.6, color: active ? C.white : C.deep }}>{String(count)}</T>
      </T>
    </Tap>
  )
}

function Section({
  title,
  note,
  items,
  onPick,
}: {
  title: string
  note: string
  items: Product[]
  onPick: (p: Product) => void
}) {
  if (!items.length) return null
  return (
    <View>
      <View style={styles.sectionHead}>
        <T style={disp(12, 1, { ls: -0.02 })}>{title}</T>
        <T style={[mono(9, 1.3, { ls: 0.12, upper: true, color: C.i38 }), { flex: 1 }]}>{note}</T>
        <T style={mono(9.5, 1, { color: C.deep })}>{String(items.length).padStart(2, '0')}</T>
      </View>
      <View style={styles.grid}>
        {items.map((p) => (
          <Tap key={p.id} style={styles.card} onPress={() => onPick(p)}>
            <View style={styles.cardImg}>
              <Image source={productImage(p)} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              {p.product_type === 'ready' ? (
                <View style={styles.readyChip}>
                  <T style={mono(7.5, 1.3, { ls: 0.1, upper: true })}>готовый</T>
                </View>
              ) : null}
            </View>
            <View style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
              <T style={disp(13.5, 1.15, { ls: -0.01 })} numberOfLines={1}>
                {p.name_ru}
              </T>
              <T style={[mono(10.5, 1.2, { color: C.i70 }), { marginTop: 4 }]}>
                {fmt(p.price)} сум
              </T>
            </View>
          </Tap>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  catTab: {
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingBottom: 7,
    marginBottom: 13,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  card: {
    width: '47.6%',
    flexGrow: 1,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  cardImg: {
    aspectRatio: 4 / 5,
    overflow: 'hidden',
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },
  readyChip: {
    position: 'absolute',
    top: 7,
    left: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.ink,
  },
})

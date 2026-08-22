import React, { useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, SIZES, fmt, noShadow, offset, type Size } from '../../src/theme/tokens'
import { body, disp, kicker, mono, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Button, SlashTitle, T, Tap } from '../../src/components/ui'
import { fetchProducts, productImage, useAsync } from '../../src/api/catalog'
import { buildPlainDesignJson } from '../../src/api/design'
import type { Product } from '../../src/api/types'
import { useCart } from '../../src/state/cart'
import { useToast } from '../../src/state/toast'

type Tab = 'all' | 'custom' | 'ready'

// Mirrors the web catalog (products-catalog.js): the same three tabs, the same
// card anatomy — image, ready chip, title, description, price — and the same
// quick add-to-bag that reveals a size row inline instead of navigating away.
// The web's 6-size row wraps to two lines at phone width.
const QUICK_SIZES: Size[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

export default function Catalog() {
  const [tab, setTab] = useState<Tab>('all')
  const { data, loading, error, reload } = useAsync(fetchProducts, [])

  const products = data ?? []
  const custom = products.filter((p) => p.product_type !== 'ready')
  const ready = products.filter((p) => p.product_type === 'ready')

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="КАТАЛОГ" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {/* The web hero, compressed to two lines. */}
        <T style={kicker(10)}>
          {`Apparel · 01—${String(Math.max(products.length, 1)).padStart(2, '0')}`}
        </T>
        <SlashTitle size={30} style={{ marginTop: 6, marginBottom: 4 }}>
          Каталог
        </SlashTitle>
        <T style={[body(13, 1.6, { color: C.i55 }), { marginBottom: 18 }]}>
          Исследуйте нашу коллекцию — настройте дизайн или купите готовое.
        </T>

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
            <Button title="Повторить" variant="ink" size={12.5} vPad={14} onPress={reload} />
          </View>
        ) : (
          <>
            {tab !== 'ready' ? (
              <Section title="Кастомизация" note="дизайн в студии" items={custom} />
            ) : null}
            {tab !== 'custom' ? (
              <View style={{ marginTop: tab === 'all' ? 26 : 0 }}>
                <Section title="Готовые дизайны" note="выберите размер" items={ready} />
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
        <T style={{ fontSize: 7.6, color: active ? C.white : C.deep }}>
          {String(count).padStart(2, '0')}
        </T>
      </T>
    </Tap>
  )
}

function Section({ title, note, items }: { title: string; note: string; items: Product[] }) {
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
          <ProductCard key={p.id} product={p} />
        ))}
      </View>
    </View>
  )
}

function ProductCard({ product: p }: { product: Product }) {
  const router = useRouter()
  const cart = useCart()
  const { flash } = useToast()
  const [sizesOpen, setSizesOpen] = useState(false)

  const isReady = p.product_type === 'ready'

  const addWithSize = (size: Size) => {
    cart.add({
      productId: p.id,
      name: p.name_ru,
      image: p.thumbnail_url,
      unitPrice: p.price,
      // A garment bought straight from the catalog carries no print.
      designJson: buildPlainDesignJson(size),
      meta: `${isReady ? 'Готовый дизайн' : 'Без принта'} · ${size}`,
      logoKey: null,
    })
    setSizesOpen(false)
    flash(`${p.name_ru} · ${size} — в корзине`)
  }

  return (
    <View style={styles.card}>
      <Tap onPress={() => router.push(`/product?id=${p.id}`)}>
        <View style={styles.cardImg}>
          <Image source={productImage(p)} style={styles.fill} resizeMode="cover" />
          {isReady ? (
            <View style={styles.readyChip}>
              <T style={mono(7.5, 1.3, { ls: 0.1, upper: true })}>готовый</T>
            </View>
          ) : null}
        </View>
      </Tap>

      <View style={styles.cardBody}>
        <T style={disp(13.5, 1.15, { ls: -0.01 })} numberOfLines={1}>
          {p.name_ru}
        </T>
        {p.description_ru ? (
          <T style={[body(10.5, 1.45, { color: C.i55 }), { marginTop: 4 }]} numberOfLines={2}>
            {p.description_ru}
          </T>
        ) : null}
        <T style={[mono(10.5, 1.2, { color: C.i70 }), { marginTop: 6 }]}>{fmt(p.price)} сум</T>

        {/* Custom garments lead with the studio, exactly like the web card. */}
        {!isReady ? (
          <Tap
            haptic
            style={styles.customBtn}
            onPress={() => router.push(`/studio?productId=${p.id}`)}
          >
            <T style={monoSemi(9, 1, { ls: 0.1, upper: true, color: C.paper })}>Настроить</T>
          </Tap>
        ) : null}

        <Tap
          haptic
          style={[styles.bagBtn, isReady && styles.bagBtnPrimary]}
          onPress={() => setSizesOpen((v) => !v)}
        >
          <T
            style={monoSemi(9, 1, {
              ls: 0.1,
              upper: true,
              color: isReady ? C.white : C.ink,
            })}
          >
            {sizesOpen ? 'Отмена' : 'В корзину'}
          </T>
        </Tap>

        {sizesOpen ? (
          <View style={styles.sizeRow}>
            {QUICK_SIZES.map((z) => (
              <Tap key={z} haptic style={styles.sizeChip} onPress={() => addWithSize(z)}>
                <T style={monoSemi(9.5, 1, { color: C.ink })}>{z}</T>
              </Tap>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 },
  fill: { width: '100%', height: '100%' },
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
  cardBody: { paddingHorizontal: 10, paddingVertical: 9 },
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
  customBtn: {
    marginTop: 9,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: C.ink,
    backgroundColor: C.ink,
    alignItems: 'center',
  },
  bagBtn: {
    marginTop: 6,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
  },
  bagBtnPrimary: { backgroundColor: C.coral, borderColor: C.ink },
  sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 7 },
  sizeChip: {
    minWidth: 30,
    paddingVertical: 7,
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.paper,
    alignItems: 'center',
  },
})

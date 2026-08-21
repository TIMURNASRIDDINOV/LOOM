import React, { useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { C, RULE, SIZES, fmt, noShadow, offset, type Size } from '../../src/theme/tokens'
import { body, disp, kicker, label as labelType, mono } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ChevronLeft } from '../../src/components/icons'
import { Button, T, Tap } from '../../src/components/ui'
import { fetchProducts, productImage, useAsync } from '../../src/api/catalog'
import { buildPlainDesignJson } from '../../src/api/design'
import { useCart } from '../../src/state/cart'
import { useToast } from '../../src/state/toast'

/**
 * A ready-made design is bought as-is: pick a size and a colour, no studio.
 * The catalog's "готовый" chip routes here instead of into the editor.
 */
export default function ProductScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const cart = useCart()
  const { flash } = useToast()
  const [size, setSize] = useState<Size>('L')

  const { data: products, loading } = useAsync(fetchProducts, [])
  const product = products?.find((p) => String(p.id) === String(id))

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <AppBar title="КАТАЛОГ" />
        <ActivityIndicator color={C.coral} style={{ marginTop: 60 }} />
      </View>
    )
  }

  if (!product) {
    return (
      <View style={{ flex: 1 }}>
        <AppBar title="КАТАЛОГ" />
        <View style={{ padding: 18, gap: 16 }}>
          <T style={body(14, 1.6, { color: C.i55 })}>Товар не найден.</T>
          <Button title="В каталог" variant="ink" size={12.5} vPad={14} onPress={() => router.push('/catalog')} />
        </View>
      </View>
    )
  }

  const colors: string[] = (() => {
    try {
      return product.base_colors ? (JSON.parse(product.base_colors) as string[]) : []
    } catch {
      return []
    }
  })()

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="КАТАЛОГ" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Tap style={styles.back} onPress={() => router.back()}>
          <ChevronLeft size={13} width={2.4} color={C.i55} />
          <T style={mono(10.5, 1, { ls: 0.16, upper: true, color: C.i55 })}>Назад</T>
        </Tap>

        <View style={styles.hero}>
          <Image source={productImage(product)} style={styles.heroImg} resizeMode="cover" />
          <View style={styles.readyChip}>
            <T style={mono(8, 1.3, { ls: 0.14, upper: true })}>готовый дизайн</T>
          </View>
        </View>

        <T style={[kicker(10), { marginTop: 18 }]}>Apparel</T>
        <View style={styles.titleRow}>
          <T style={[disp(27, 1.05, { ls: -0.03 }), { flex: 1 }]}>{product.name_ru}</T>
          <T style={mono(13, 1, { color: C.i70 })}>{fmt(product.price)}</T>
        </View>

        {product.description_ru ? (
          <T style={[body(13, 1.6, { color: C.i55 }), { marginTop: 8 }]}>{product.description_ru}</T>
        ) : null}

        {colors.length ? (
          <View style={{ marginTop: 16 }}>
            <T style={[labelType(), { marginBottom: 8 }]}>Цвета</T>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {colors.map((hex) => (
                <View key={hex} style={[styles.colorDot, { backgroundColor: hex }]} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: 18 }}>
          <T style={[labelType(), { marginBottom: 8 }]}>Размер</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {SIZES.map((z) => {
              const on = size === z
              return (
                <Tap
                  key={z}
                  haptic
                  onPress={() => setSize(z)}
                  style={[
                    styles.sizeBtn,
                    { backgroundColor: on ? C.ink : C.white },
                    on ? offset(2, C.coral) : noShadow,
                  ]}
                >
                  <T style={disp(13.5, 1, { color: on ? C.paper : C.i70 })}>{z}</T>
                </Tap>
              )
            })}
          </View>
        </View>

        <Button
          title={`В корзину · ${fmt(product.price)}`}
          size={16}
          vPad={17}
          style={{ marginTop: 22 }}
          onPress={() => {
            cart.add({
              productId: product.id,
              name: product.name_ru,
              image: product.thumbnail_url,
              unitPrice: product.price,
              designJson: buildPlainDesignJson(size, colors[0] ?? '#FFFFFF'),
              meta: `Готовый дизайн · ${size}`,
              logoKey: null,
            })
            flash('Добавлено в корзину')
            router.push('/cart')
          }}
        />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 32 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 14 },
  hero: { aspectRatio: 4 / 5, borderWidth: RULE, borderColor: C.ink, overflow: 'hidden' },
  heroImg: { width: '100%', height: '100%' },
  readyChip: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: C.paper,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: C.ink,
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4 },
  colorDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  sizeBtn: {
    minWidth: 46,
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

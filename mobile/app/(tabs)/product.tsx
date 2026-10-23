import React, { useMemo, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, RULE, fmt, type Size } from '../../src/theme/tokens'
import { body, disp, label as labelType, mono, monoSemi } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Button, EmptyState, OfflineState, Skeleton, SizePicker, Swatch, T, isOffline } from '../../src/components/ui'
import { Heading } from '../../src/components/shop/Heading'
import { CartButton } from '../../src/components/shop/CartButton'
import { sizeLine } from '../../src/components/shop/sizes'
import { Model3D } from '../../src/components/Model3D'
import { fetchProducts, productImage, useAsync } from '../../src/api/catalog'
import { buildPlainDesignJson } from '../../src/api/design'
import { track } from '../../src/api/track'
import { colorName, productName, useI18n } from '../../src/i18n'
import { goBack } from '../../src/lib/nav'
import { fabricForProduct } from '../../src/lib/scene-html'
import { productConfig, swatchName } from '../../src/lib/product-config'
import { useCart } from '../../src/state/cart'
import { useToast } from '../../src/state/toast'

// W13. A product from the live catalogue: the 3D stage (the product's own
// `glb_url`, else its photo), colour and size, and two actions — design it in
// the studio, or put the plain garment in the cart. Price and colours are the
// server's; the size line is the web configurator's size guide.

export default function ProductScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const cart = useCart()
  const { flash } = useToast()
  const { t, lang } = useI18n()
  const [pickedSize, setSize] = useState<Size | null>(null)
  const [pickedColor, setColor] = useState<string | null>(null)

  const { data: products, loading, error, reload } = useAsync(fetchProducts, [])
  const product = products?.find((p) => String(p.id) === String(id))
  // Sizes and colours from the product's config (LOOM-166).
  const cfg = productConfig(product)
  const size = pickedSize ?? (cfg.sizes.includes('L') ? 'L' : cfg.sizes[0])
  const color = pickedColor ?? cfg.colors.find((c) => c.available)?.hex ?? '#FFFFFF'
  const swatch = cfg.colors.find((c) => c.hex === color)
  const colorLabel = swatch ? swatchName(swatch, lang, t) : colorName(color, t)
  const line = sizeLine(size, t('product.cm'))
  const design = useMemo(() => ({ shirtColor: color, front: [], back: [] }), [color])

  const header = (
    <BackHeader
      title={t('product.toCatalog')}
      onBack={() => goBack(router, '/catalog')}
      right={<CartButton />}
    />
  )

  if (error && !products) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.pad}>
          {isOffline(error) ? (
            <OfflineState onRetry={reload} />
          ) : (
            <EmptyState title={t('catalog.loadFailed')} action={t('common.retry')} onAction={reload} />
          )}
        </View>
      </View>
    )
  }

  if (loading && !products) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.pad}>
          <Skeleton height={280} lines={['40%', '70%', '30%']} />
        </View>
      </View>
    )
  }

  if (!product) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.pad}>
          <EmptyState
            title={t('st.productUnavailable')}
            action={t('product.toCatalog')}
            onAction={() => router.replace('/catalog')}
          />
        </View>
      </View>
    )
  }

  const type = product.product_type ?? 'custom'
  const name = productName(product, lang)
  const price = `${fmt(product.price)} ${t('common.sum')}`
  const index = (products?.indexOf(product) ?? 0) + 1

  const addPlain = () => {
    cart.add({
      productId: product.id,
      name,
      image: product.thumbnail_url,
      unitPrice: product.price,
      designJson: buildPlainDesignJson(size, color),
      meta: [colorLabel, size, type === 'ready' ? t('catalog.readyDesign') : t('common.noPrint')].join(' · '),
      logoKey: null,
    })
    track('cfg_cart')
    flash(t('product.added'))
    router.push('/cart')
  }

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.stage}>
          {product.glb_url ? (
            // In a ScrollView: a vertical swipe on the model scrolls the page. The "3D · 360°"
            // caption and the diagnostics behind its long press are Model3D's.
            <Model3D glbUrl={product.glb_url} printArea={cfg.printArea} fabric={fabricForProduct(product)} design={design} view="front" inScroll photo={productImage(product)} />
          ) : (
            <Image source={productImage(product)} style={styles.photo} resizeMode="contain" />
          )}
        </View>

        <View style={styles.body}>
          <View style={{ gap: 4 }}>
            <T style={mono(12, 16 / 12, { ls: 0.14, upper: true, color: C.i70 })}>{`Apparel · ${String(index).padStart(2, '0')}`}</T>
            <Heading style={disp(28, 1.05, { ls: -0.03 })}>
              {name}
            </Heading>
            <T style={monoSemi(17, 22 / 17)}>{price}</T>
          </View>

          {product.description_ru ? <T style={body(14, 21 / 14, { color: C.i70 })}>{product.description_ru}</T> : null}

          <View style={{ gap: 8 }}>
            <T style={labelType()}>
              {`${t('product.colors')} · `}
              <T style={{ color: C.ink }}>{colorLabel}</T>
            </T>
            <View style={styles.swatches} accessibilityRole="radiogroup">
              {cfg.colors.map((c) => (
                <Swatch
                  key={c.hex}
                  hex={c.hex}
                  label={c.available ? swatchName(c, lang, t) : `${swatchName(c, lang, t)}, ${t('st.unavailable')}`}
                  selected={c.hex === color}
                  disabled={!c.available}
                  onPress={() => setColor(c.hex)}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <T style={labelType()}>{t('product.size')}</T>
            <SizePicker sizes={cfg.sizes} value={size} onChange={setSize} />
            {line ? <T style={mono(12, 16 / 12, { color: C.i70 })}>{line}</T> : null}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
        {type === 'custom' ? (
          <Button title={t('product.design')} onPress={() => router.push(`/studio?productId=${product.id}`)} />
        ) : null}
        <Button
          title={t('product.addToCart', { price: fmt(product.price) })}
          variant={type === 'custom' ? 'outline' : 'primary'}
          style={type === 'custom' ? { backgroundColor: C.white } : undefined}
          onPress={addPlain}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  stage: {
    height: 280,
    backgroundColor: C.paper2,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '100%', height: 250 },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20, gap: 14 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: RULE,
    borderTopColor: C.ink,
    backgroundColor: C.paper,
  },
})

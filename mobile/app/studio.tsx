import React, { useEffect, useRef } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, RULE, fmt, offset } from '../src/theme/tokens'
import { disp, mono, monoSemi } from '../src/theme/type'
import { LayerInspector } from '../src/components/LayerInspector'
import { Stage } from '../src/components/Stage'
import { ToolSheet } from '../src/components/ToolSheet'
import { Cart, ChevronLeft, ImageTool, SizeTool, TypeTool } from '../src/components/icons'
import { Segmented, T, Tap, Toast } from '../src/components/ui'
import { buildDesignJson, designMissingUploads } from '../src/api/design'
import { fetchProducts, useAsync } from '../src/api/catalog'
import { uploadFile } from '../src/api/client'
import { track } from '../src/api/track'
import { useCart } from '../src/state/cart'
import { useStudio } from '../src/state/studio'
import { useToast } from '../src/state/toast'

export default function Studio() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { productId } = useLocalSearchParams<{ productId?: string }>()
  const { message, flash } = useToast()
  const cart = useCart()
  const st = useStudio()
  const { s, face, surface, tool, layerCount, total, active } = st
  const busyRef = useRef(false)

  const { data: products } = useAsync(fetchProducts, [])

  useEffect(() => {
    track('cfg_open')
  }, [])

  // Deep-linked from the catalog: adopt that product's name and price.
  useEffect(() => {
    if (!productId || !products) return
    const p = products.find((x) => String(x.id) === String(productId))
    if (p) st.loadProduct({ id: p.id, name: p.name_ru, price: p.price })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, products])

  // First layer placed → funnel event, same as the web configurator.
  useEffect(() => {
    if (layerCount > 0) track('cfg_design_add')
  }, [layerCount])
  useEffect(() => {
    if (surface === '3d') track('cfg_preview_3d')
  }, [surface])

  const product = products?.find((p) => p.id === s.productId)

  const addToCart = async () => {
    if (busyRef.current) return
    if (layerCount === 0 && !s.back.art && !s.back.text?.content) {
      flash('Добавьте текст или графику — или купите без принта в каталоге')
      return
    }
    busyRef.current = true
    try {
      // A logo whose upload failed earlier gets one more try here — the print
      // shop cannot work from a file that only exists on the phone.
      const keys: Record<'front' | 'back', string | null> = {
        front: s.front.art?.uploadKey ?? null,
        back: s.back.art?.uploadKey ?? null,
      }
      if (designMissingUploads(s)) {
        for (const f of ['front', 'back'] as const) {
          const a = s[f].art
          if (a?.uri && !a.uploadKey && !a.pattern) {
            try {
              const key = await uploadFile(a.uri, a.name || 'artwork.png', a.mime ?? 'image/png')
              keys[f] = key
              st.updateArtOn(f, { uploadKey: key })
            } catch {
              flash('Не удалось загрузить графику. Проверьте соединение.')
              return
            }
          }
        }
      }
      // `s` is the render-time snapshot; fold the fresh keys in for this build.
      const snapshot = {
        ...s,
        front: { ...s.front, art: s.front.art ? { ...s.front.art, uploadKey: keys.front } : null },
        back: { ...s.back, art: s.back.art ? { ...s.back.art, uploadKey: keys.back } : null },
      }

      const meta = [
        s.colorName,
        s.size,
        active.art?.name,
        active.text?.content ? `«${active.text.content}»` : null,
      ]
        .filter(Boolean)
        .join(' · ')

      cart.add({
        productId: s.productId,
        name: s.productName,
        image: product?.thumbnail_url ?? null,
        unitPrice: total,
        designJson: buildDesignJson(snapshot),
        meta,
        logoKey: keys.front ?? keys.back ?? null,
      })
      track('cfg_cart')
      flash('Добавлено в корзину')
      router.push('/cart')
    } finally {
      busyRef.current = false
    }
  }

  // The sheet is capped so the garment always keeps most of the stage.
  const sheetMax = Math.min(Math.round(height * 0.34), 320)

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Tap style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft />
        </Tap>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T style={mono(8.5, 1.3, { ls: 0.22, upper: true, color: C.coral })}>Студия</T>
          <T style={disp(15, 1.15, { ls: -0.02 })} numberOfLines={1}>
            {s.productName}
          </T>
        </View>
        <Segmented
          value={surface}
          onChange={st.setSurface}
          options={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
        />
      </View>

      <View style={styles.stageWrap}>
        <Stage glbUrl={product?.glb_url ?? null} />
        <View style={styles.faceToggle}>
          <Segmented
            value={face}
            onChange={st.setFace}
            hPad={17}
            vPad={11}
            options={[
              { value: 'front', label: 'Перед' },
              { value: 'back', label: 'Зад' },
            ]}
          />
        </View>
        <T style={[mono(9.5, 1.4, { ls: 0.16, upper: true, color: C.i38 }), styles.layerCount]}>
          {`${layerCount} сл. · ${s.colorName}`}
        </T>
      </View>

      <LayerInspector />
      <ToolSheet maxHeight={sheetMax} />

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.rail}>
          <RailBtn
            label="Текст"
            active={tool === 'text'}
            onPress={() => st.pickTool('text')}
            icon={<TypeTool color={tool === 'text' ? C.paper : C.ink} />}
          />
          <RailBtn
            label="Графика"
            active={tool === 'image'}
            onPress={() => st.pickTool('image')}
            icon={<ImageTool color={tool === 'image' ? C.paper : C.ink} />}
          />
          <RailBtn
            label="Цвет"
            active={tool === 'color'}
            onPress={() => st.pickTool('color')}
            icon={
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: s.color, borderColor: tool === 'color' ? C.paper : C.ink },
                ]}
              />
            }
          />
          <RailBtn
            label={s.size}
            active={tool === 'size'}
            onPress={() => st.pickTool('size')}
            icon={<SizeTool color={tool === 'size' ? C.paper : C.ink} />}
          />
        </View>

        <View style={styles.checkoutRow}>
          <View>
            <T style={monoSemi(9, 1.3, { ls: 0.16, upper: true, color: C.i55 })}>Итого</T>
            <T style={disp(21, 1, { ls: -0.03 })}>{fmt(total)}</T>
          </View>
          <Tap haptic style={[styles.cta, offset(3, C.ink)]} onPress={addToCart}>
            <Cart color={C.white} width={2} size={18} />
            <T style={disp(17, 1.1, { ls: 0.02, upper: true, color: C.white })}>В корзину</T>
          </Tap>
        </View>
      </View>

      <Toast message={message} bottom={150} />
    </KeyboardAvoidingView>
  )
}

function RailBtn({
  label,
  icon,
  active,
  onPress,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onPress: () => void
}) {
  return (
    <Tap
      haptic
      onPress={onPress}
      style={[styles.railBtn, { backgroundColor: active ? C.ink : C.white }]}
    >
      {icon}
      <T style={monoSemi(9.5, 1, { ls: 0.1, upper: true, color: active ? C.paper : C.ink })}>
        {label}
      </T>
    </Tap>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageWrap: {
    flex: 1,
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 52,
  },
  faceToggle: { position: 'absolute', left: 16, bottom: 12 },
  layerCount: { position: 'absolute', right: 16, bottom: 12 },

  dock: {
    borderTopWidth: RULE,
    borderTopColor: C.ink,
    backgroundColor: C.paper,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  rail: { flexDirection: 'row', gap: 7, marginBottom: 10 },
  railBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderWidth: RULE,
    borderColor: C.ink,
  },
  colorDot: { width: 19, height: 19, borderRadius: 9.5, borderWidth: RULE },

  checkoutRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
  },
})

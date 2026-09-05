import React from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, fmt } from '../../src/theme/tokens'
import { body, disp, mono, monoMed, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Button, SlashTitle, T, Tap } from '../../src/components/ui'
import { GARMENT_FLAT } from '../../src/api/catalog'
import { useT } from '../../src/i18n'
import { useCart } from '../../src/state/cart'

export default function CartScreen() {
  const router = useRouter()
  const t = useT()
  const { items, count, total, setQty, remove } = useCart()
  const sum = t('common.sum')

  return (
    <View style={{ flex: 1 }}>
      <AppBar title={t('bar.cart')} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <SlashTitle size={34}>{t('cart.title')}</SlashTitle>
        <T style={[mono(11, 1.4, { ls: 0.14, upper: true, color: C.i38 }), { marginTop: 6, marginBottom: 22 }]}>
          {count ? t('cart.count', { n: count }) : t('cart.emptyTag')}
        </T>

        {items.length === 0 ? (
          <View>
            <T style={[disp(26, 1.1, { ls: -0.02, color: C.coral }), styles.empty]}>{t('cart.emptyTitle')}</T>
            <Button
              title={t('cart.openStudio')}
              variant="ink"
              size={12.5}
              vPad={15}
              style={{ alignSelf: 'flex-start', paddingHorizontal: 26 }}
              onPress={() => router.push('/studio')}
            />
          </View>
        ) : (
          <>
            {items.map((it) => (
              <View key={it.id} style={styles.row}>
                <View style={styles.thumb}>
                  <Image
                    source={it.image ? { uri: it.image } : GARMENT_FLAT}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode={it.image ? 'cover' : 'contain'}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                  <T style={disp(15, 1.15, { ls: -0.01 })} numberOfLines={1}>
                    {it.name}
                  </T>
                  <T style={mono(10.5, 1.3, { color: C.i55 })} numberOfLines={2}>
                    {it.meta}
                  </T>
                  <View style={styles.qtyRow}>
                    <View style={styles.stepper}>
                      <Tap style={styles.stepBtn} onPress={() => setQty(it.id, it.quantity - 1)}>
                        <T style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: C.i70 }}>−</T>
                      </Tap>
                      <View style={styles.qtyVal}>
                        <T style={monoMed(12, 1)}>{String(it.quantity)}</T>
                      </View>
                      <Tap style={styles.stepBtn} onPress={() => setQty(it.id, it.quantity + 1)}>
                        <T style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: C.i70 }}>+</T>
                      </Tap>
                    </View>
                    <T style={[monoSemi(13, 1), { marginLeft: 'auto' }]}>{fmt(it.unitPrice * it.quantity)}</T>
                    <Tap style={styles.removeBtn} onPress={() => remove(it.id)} hitSlop={6}>
                      <T style={{ fontSize: 16, lineHeight: 20, color: C.i55 }}>×</T>
                    </Tap>
                  </View>
                </View>
              </View>
            ))}

            <View style={styles.totals}>
              <Line label={t('cart.items')} value={`${fmt(total)} ${sum}`} />
              <Line label={t('cart.delivery')} value={t('cart.deliveryFree')} valueColor={C.green} />
              <View style={styles.grandRow}>
                <T style={disp(15, 1)}>{t('cart.total')}</T>
                <T style={disp(24, 1, { ls: -0.03 })}>{`${fmt(total)} ${sum}`}</T>
              </View>
            </View>

            <Button title={t('cart.checkout')} style={{ marginTop: 16 }} vPad={17} onPress={() => router.push('/checkout')} />
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Line({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.line}>
      <T style={body(13, 1, { color: C.i70 })}>{label}</T>
      <T style={mono(13, 1, { color: valueColor ?? C.i70 })}>{value}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  empty: { maxWidth: 260, marginTop: 30, marginBottom: 22 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line },
  thumb: {
    width: 74,
    height: 74,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    overflow: 'hidden',
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  stepper: { flexDirection: 'row', borderWidth: 1, borderColor: C.ink },
  stepBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  qtyVal: { minWidth: 30, alignItems: 'center', justifyContent: 'center' },
  removeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  totals: { borderTopWidth: RULE, borderTopColor: C.ink, marginTop: 6, paddingTop: 15, gap: 9 },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  grandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 },
})

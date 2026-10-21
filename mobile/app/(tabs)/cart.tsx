import React, { useCallback, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, mono, monoBold, monoSemi } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Trash } from '../../src/components/icons'
import { Button, OfflineState, Skeleton, Stepper, T, Tap, isOffline } from '../../src/components/ui'
import { Heading } from '../../src/components/shop/Heading'
import { GARMENT_FLAT } from '../../src/api/catalog'
import { useT } from '../../src/i18n'
import { useCart } from '../../src/state/cart'
import { useToast } from '../../src/state/toast'

// W14 cart, W15 empty. Signed in, the list and the total are the server's
// (`/api/cart`): the stepper PATCHes, "−" at 1 and the bin DELETE.

export default function CartScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const t = useT()
  const { flash } = useToast()
  const { items, loading, error, notice, dismissNotice, count, total, setQty, remove, reload } = useCart()
  const [busy, setBusy] = useState<string | null>(null)
  const sum = t('common.sum')

  // Every visit reads the server cart again and sends anything that waited for a connection.
  useFocusEffect(
    useCallback(() => {
      reload().catch(() => {})
    }, [reload]),
  )

  // One request per row at a time: the server's answer is the number shown.
  const change = async (id: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      flash(isOffline(e) ? t('common.offline') : t('cart.errUpdate'))
    } finally {
      setBusy(null)
    }
  }

  const header = <BackHeader title={t('cart.title')} />

  if (items.length === 0 && error) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.page}>
          <Heading style={disp(34, 1, { ls: -0.035 })}>{t('cart.title')}</Heading>
          <OfflineState onRetry={() => reload().catch(() => {})} title={isOffline(error) ? undefined : t('cart.errUpdate')} />
        </View>
      </View>
    )
  }

  if (items.length === 0 && loading) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.page}>
          <Heading style={disp(34, 1, { ls: -0.035 })}>{t('cart.title')}</Heading>
          <View style={[styles.list, offset(2)]}>
            <View style={styles.row}>
              <Skeleton height={88} lines={[]} style={{ width: 88 }} />
              <Skeleton height={12} lines={['70%', '50%']} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </View>
    )
  }

  // W15 — nothing in the cart.
  if (items.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.empty}>
          {notice ? <Notice text={notice} onClose={dismissNotice} /> : null}
          <View style={{ flex: 1, gap: 22 }}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.ghost}>
              <Image source={GARMENT_FLAT} style={{ height: 190, width: '100%', opacity: 0.45 }} resizeMode="contain" />
              <View style={[styles.stamp, offset(2)]}>
                <T style={monoBold(14, 18 / 14, { ls: 0.14, upper: true })}>{t('cart.emptyTag')}</T>
              </View>
            </View>
            <Heading style={disp(30, 1.05, { ls: -0.03 })}>{t('cart.emptyTitle')}</Heading>
          </View>
          <View style={{ gap: 10 }}>
            <Button title={`${t('cart.openStudio')} →`} onPress={() => router.push('/studio')} />
            <Tap accessibilityRole="link" onPress={() => router.push('/catalog')} style={styles.link}>
              <T style={[monoSemi(13, 18 / 13, { ls: 0.08 }), { textDecorationLine: 'underline' }]}>{t('home.catalogLink')}</T>
            </Tap>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 6 }}>
          <Heading style={disp(34, 1, { ls: -0.035 })}>{t('cart.title')}</Heading>
          <T style={mono(12, 16 / 12, { ls: 0.06, color: C.i70 })}>{t('cart.count', { n: count })}</T>
        </View>

        {notice ? <Notice text={notice} onClose={dismissNotice} /> : null}

        <View style={[styles.list, offset(2)]}>
          {items.map((it, i) => (
            <View
              key={it.id}
              style={[styles.row, i < items.length - 1 && styles.rowRule, busy === it.id && { opacity: 0.5, pointerEvents: 'none' }]}
            >
              <View style={styles.thumb}>
                <Image
                  source={it.image ? { uri: it.image } : GARMENT_FLAT}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode={it.image ? 'cover' : 'contain'}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <T style={disp(16, 20 / 16)} numberOfLines={2}>
                  {it.name}
                </T>
                {it.meta ? (
                  <T style={mono(12, 16 / 12, { color: C.i70 })} numberOfLines={2}>
                    {it.meta}
                  </T>
                ) : null}
                <T style={monoSemi(15, 20 / 15)}>{`${fmt(it.unitPrice * it.quantity)} ${sum}`}</T>
                <View style={styles.qtyRow}>
                  <Stepper value={it.quantity} min={0} onChange={(q) => change(it.id, () => setQty(it.id, q))} />
                  <Tap
                    accessibilityRole="button"
                    accessibilityLabel={t('cart.remove')}
                    onPress={() => change(it.id, () => remove(it.id))}
                    style={styles.bin}
                  >
                    <Trash />
                  </Tap>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <Line label={t('cart.items')} value={`${fmt(total)} ${sum}`} />
          <Line label={t('cart.delivery')} value={t('cart.deliveryFree')} />
          <View style={styles.grand}>
            <T style={disp(18, 1.2)}>{t('cart.total')}</T>
            <T style={monoBold(18, 1.2)}>{`${fmt(total)} ${sum}`}</T>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
        <Button title={`${t('cart.checkout')} →`} onPress={() => router.push('/checkout')} />
      </View>
    </View>
  )
}

function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  const t = useT()
  return (
    <View accessibilityRole="alert" style={styles.notice}>
      <T style={[body(14, 20 / 14), { flex: 1 }]}>{text}</T>
      <Tap accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.noticeX}>
        <T style={disp(18, 1)}>×</T>
      </Tap>
    </View>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <T style={body(14, 20 / 14, { color: C.i70 })}>{label}</T>
      <T style={mono(14, 20 / 14)}>{value}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24, gap: 16 },
  empty: { flex: 1, paddingHorizontal: 16, paddingTop: 28, paddingBottom: 34 },
  ghost: {
    alignSelf: 'center',
    width: 240,
    height: 240,
    borderWidth: RULE,
    borderStyle: 'dashed',
    borderColor: 'rgba(19,19,17,.4)',
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stamp: {
    position: 'absolute',
    top: -14,
    left: -10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
  },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },

  list: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, marginRight: 2 },
  row: { flexDirection: 'row', gap: 12, padding: 12 },
  rowRule: { borderBottomWidth: RULE, borderBottomColor: C.ink },
  thumb: {
    width: 88,
    height: 88,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.paper2,
    overflow: 'hidden',
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  bin: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  totals: { gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  grand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingVertical: 4,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  noticeX: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  bar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: RULE,
    borderTopColor: C.ink,
    backgroundColor: C.paper,
  },
})

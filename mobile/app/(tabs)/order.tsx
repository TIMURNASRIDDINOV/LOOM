import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ApiError } from '../../src/api/client'
import { C, HAIR, RULE, fmt, offset } from '../../src/theme/tokens'
import { body, disp, kicker, mono, monoBold, monoSemi } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { BoxIcon, Refresh } from '../../src/components/icons'
import { EmptyState, OfflineState, Skeleton, T, Tap, isOffline } from '../../src/components/ui'
import { Send } from '../../src/components/account/icons'
import { THUMB_BG } from '../../src/components/account/OrderCard'
import { StatusChip } from '../../src/components/account/StatusChip'
import { Timeline } from '../../src/components/account/Timeline'
import { dayLabel, itemMeta, itemName } from '../../src/components/account/format'
import { buildSteps } from '../../src/components/account/steps'
import { useRepeatOrder } from '../../src/components/account/useRepeatOrder'
import { fetchProducts, GARMENT_FLAT, useAsync } from '../../src/api/catalog'
import { fetchOrder } from '../../src/api/orders'
import type { Product } from '../../src/api/types'
import { useI18n } from '../../src/i18n'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

const BOT_URL = 'https://t.me/looom_design_bot'

// W31 order detail, `/order?id=`. No tab bar. Reads `GET /api/me/orders/:id`:
// 404 (not the caller's order, or none) is the not-found state.
export default function Order() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { t, lang } = useI18n()
  const { flash } = useToast()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { signedIn, loading: authLoading } = useAuth()
  const { repeat, busyId } = useRepeatOrder()
  const orderId = /^\d+$/.test(id ?? '') ? Number(id) : null

  const { data, error, loading, reload } = useAsync(
    () => (signedIn && orderId !== null ? fetchOrder(orderId) : Promise.resolve(null)),
    [signedIn, orderId],
  )
  const [products, setProducts] = useState<Product[]>([])
  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => {})
  }, [])

  const steps = useMemo(() => (data ? buildSteps(data.order, data.status_log) : []), [data])
  const status = error instanceof ApiError ? error.status : null
  const notFound = orderId === null || status === 404
  const out = status === 401

  let content: React.ReactNode
  if (authLoading || (signedIn && loading && !data)) {
    content = (
      <>
        <Skeleton height={60} lines={['50%']} />
        <Skeleton height={120} lines={['70%', '50%']} />
      </>
    )
  } else if (!signedIn || out) {
    content = (
      <EmptyState
        icon={<BoxIcon size={32} width={1.8} />}
        title={t('acc.signInTitle')}
        body={t('orders.signIn')}
        action={t('common.signIn')}
        onAction={() => router.push('/login')}
      />
    )
  } else if (notFound) {
    content = (
      <EmptyState
        icon={<BoxIcon size={32} width={1.8} />}
        title={t('orders.notFoundTitle')}
        body={t('orders.notFoundBody')}
        action={t('orders.toOrders')}
        onAction={() => router.replace('/orders')}
      />
    )
  } else if (error) {
    content = isOffline(error) ? (
      <OfflineState onRetry={reload} />
    ) : (
      <EmptyState
        icon={<BoxIcon size={32} width={1.8} />}
        title={t('orders.detailErr')}
        body={error.message}
        action={t('common.retry')}
        onAction={reload}
      />
    )
  } else if (data) {
    const { order, items } = data
    const sum = t('common.sum')
    const online = order.payment_method && order.payment_method !== 'cod'
    const payment = online
      ? `${order.payment_method === 'payme' ? 'Payme' : order.payment_method === 'click' ? 'Click' : 'Uzum'}${
          order.payment_status === 'paid' ? ` · ${t('orders.payPaid')}` : ''
        }`
      : t('orders.payCod')

    content = (
      <>
        <View style={{ gap: 10 }}>
          <View style={styles.between}>
            <StatusChip status={order.status} />
            <T style={mono(12, 4 / 3, { color: C.i70 })}>{dayLabel(order.created_at, t)}</T>
          </View>
          <T style={disp(28, 1.05, { ls: -0.03 })}>{t('orders.orderFor', { price: fmt(order.total_price) })}</T>
        </View>

        <Timeline steps={steps} />

        <View accessibilityLabel={t('orders.itemsTitle')} style={{ gap: 8 }}>
          <T style={[kicker(), styles.heading]}>{t('orders.itemsTitle')}</T>
          {items.map((it) => (
            <View key={it.id} style={styles.item}>
              <View style={styles.thumb}>
                <Image source={GARMENT_FLAT} style={{ width: 48, height: 48 }} resizeMode="contain" />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T style={disp(15, 1.2)} numberOfLines={2}>
                  {itemName(it, products, lang, t)}
                </T>
                <T style={mono(12, 4 / 3, { color: C.i70 })} numberOfLines={2}>
                  {itemMeta(it, t)}
                </T>
              </View>
              <T style={monoSemi(14, 1.2)}>{`${fmt(it.unit_price * it.quantity)} ${sum}`}</T>
            </View>
          ))}
        </View>

        <View style={styles.facts}>
          {order.address ? <Fact label={t('orders.address')} value={order.address} /> : null}
          <Fact label={t('orders.payment')} value={payment} />
          <Fact label={t('orders.delivery')} value={t('orders.deliveryFree')} mono />
          <View style={styles.total}>
            <T style={disp(18, 1.2)}>{t('orders.total')}</T>
            <T style={monoBold(18, 1.2)}>{`${fmt(order.total_price)} ${sum}`}</T>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Tap
            accessibilityRole="button"
            onPress={() => WebBrowser.openBrowserAsync(BOT_URL).catch(() => flash(t('orders.tgFail')))}
            style={styles.action}
          >
            <Send size={16} width={2.4} />
            <T style={disp(13, 1)}>{t('orders.telegram')}</T>
          </Tap>
          <Tap
            accessibilityRole="button"
            disabled={busyId === order.id}
            onPress={() => repeat(order.id, items)}
            style={styles.action}
          >
            {busyId === order.id ? <ActivityIndicator size="small" color={C.ink} /> : <Refresh size={16} />}
            <T style={disp(13, 1)}>{t('orders.repeat')}</T>
          </Tap>
        </View>
      </>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <BackHeader title={orderId !== null ? `#LM-${orderId}` : undefined} onBack={() => router.canGoBack() ? router.back() : router.replace('/orders')} />
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
    </View>
  )
}

function Fact({ label, value, mono: isMono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fact}>
      <T style={body(14, 20 / 14, { color: C.i70 })}>{label}</T>
      <T style={[isMono ? mono(14, 20 / 14) : body(14, 20 / 14), { flexShrink: 1, textAlign: 'right' }]}>{value}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, gap: 20 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { paddingBottom: 6, borderBottomWidth: HAIR, borderBottomColor: C.line },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  thumb: {
    width: 56,
    height: 56,
    borderWidth: 1.5,
    borderColor: C.ink,
    backgroundColor: THUMB_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facts: { gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 10,
    borderTopWidth: HAIR,
    borderTopColor: C.line,
  },
  action: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    ...offset(2),
  },
})

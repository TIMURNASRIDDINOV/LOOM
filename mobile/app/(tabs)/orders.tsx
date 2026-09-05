import React from 'react'
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'

import { C, RULE, STATUSES, fmt } from '../../src/theme/tokens'
import { body, disp, mono, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Button, Panel, SlashTitle, T, Tap } from '../../src/components/ui'
import { GARMENT_FLAT, fetchMyOrders, useAsync, useRefreshOnFocus } from '../../src/api/catalog'
import { summarizeDesign } from '../../src/api/design'
import type { Order } from '../../src/api/types'
import { shortDate, statusLabel, useT, type TFn } from '../../src/i18n'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

const BOT_URL = 'https://t.me/looom_design_bot'

export default function Orders() {
  const router = useRouter()
  const t = useT()
  const { signedIn } = useAuth()
  const { data, loading, error, reload } = useAsync(
    () => (signedIn ? fetchMyOrders() : Promise.resolve([])),
    [signedIn],
  )
  useRefreshOnFocus(reload)

  const orders = data ?? []
  const [current, ...past] = orders

  return (
    <View style={{ flex: 1 }}>
      <AppBar title={t('bar.orders')} />
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!orders.length} onRefresh={reload} tintColor={C.coral} />}
      >
        <SlashTitle size={30} style={{ marginBottom: 20 }}>
          {t('orders.title')}
        </SlashTitle>

        {!signedIn ? (
          <View style={{ gap: 18 }}>
            <T style={body(14, 1.6, { color: C.i55 })}>{t('orders.signIn')}</T>
            <Button
              title={t('common.signIn')}
              variant="ink"
              size={12.5}
              vPad={15}
              style={{ alignSelf: 'flex-start', paddingHorizontal: 26 }}
              onPress={() => router.push('/login')}
            />
          </View>
        ) : loading && !orders.length ? (
          <ActivityIndicator color={C.coral} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={{ gap: 16 }}>
            <T style={body(14, 1.6, { color: C.i55 })}>{error.message}</T>
            <Button title={t('common.retry')} variant="ink" size={12.5} vPad={14} onPress={reload} />
          </View>
        ) : !orders.length ? (
          <View style={{ gap: 18 }}>
            <T style={[disp(26, 1.1, { ls: -0.02, color: C.coral }), { maxWidth: 260 }]}>{t('orders.empty')}</T>
            <Button
              title={t('orders.openStudio')}
              variant="ink"
              size={12.5}
              vPad={15}
              style={{ alignSelf: 'flex-start', paddingHorizontal: 26 }}
              onPress={() => router.push('/studio')}
            />
          </View>
        ) : (
          <>
            <CurrentOrder order={current} t={t} />
            {past.map((o) => (
              <PastOrder key={o.id} order={o} t={t} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function statusIndex(status: string) {
  const i = STATUSES.findIndex((s) => s.k === status)
  return Math.max(0, i)
}

/** The newest order gets the full status ladder. */
function CurrentOrder({ order, t }: { order: Order; t: TFn }) {
  const router = useRouter()
  const { flash } = useToast()
  const idx = statusIndex(order.status)
  const st = STATUSES[idx]
  const cancelled = order.status === 'cancelled'

  return (
    <Panel raised style={{ marginBottom: 16 }}>
      <View style={styles.header}>
        <View style={styles.thumb}>
          <Image source={GARMENT_FLAT} style={styles.fill} resizeMode="contain" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T style={mono(10, 1, { ls: 0.18, upper: true, color: C.i38 })}>
            {`#LM-${order.id} · ${shortDate(order.created_at, t)}`}
          </T>
          <T style={[disp(16, 1.1, { ls: -0.02 }), { marginTop: 4, marginBottom: 5 }]} numberOfLines={1}>
            {summarizeDesign(order.design_json, t) || t('orders.orderFor', { price: fmt(order.total_price) })}
          </T>
          <View style={[styles.statusChip, { borderColor: cancelled ? C.i38 : st.c }]}>
            <View style={{ width: 6, height: 6, backgroundColor: cancelled ? C.i38 : st.c }} />
            <T style={monoSemi(10, 1, { ls: 0.12, upper: true, color: cancelled ? C.i55 : st.c })}>
              {statusLabel(order.status, t)}
            </T>
          </View>
        </View>
      </View>

      {!cancelled ? (
        <View style={{ paddingHorizontal: 14, paddingVertical: 16 }}>
          {STATUSES.map((x, i) => (
            <View key={x.k} style={{ flexDirection: 'row', gap: 11, alignItems: 'flex-start' }}>
              <View style={{ alignItems: 'center' }}>
                <View
                  style={{
                    width: 13,
                    height: 13,
                    borderWidth: RULE,
                    borderColor: i <= idx ? x.c : C.line,
                    backgroundColor: i <= idx ? x.c : C.white,
                  }}
                />
                {i < STATUSES.length - 1 ? (
                  <View style={{ width: 1.5, height: 26, backgroundColor: i < idx ? x.c : C.line }} />
                ) : null}
              </View>
              <View style={{ paddingBottom: i < STATUSES.length - 1 ? 14 : 0, marginTop: -2 }}>
                <T
                  style={{
                    ...disp(13.5, 1.2, { color: i <= idx ? C.ink : C.i38 }),
                    fontFamily: i === idx ? 'InterTight_700Bold' : 'InterTight_500Medium',
                  }}
                >
                  {statusLabel(x.k, t)}
                </T>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Tap
          style={[styles.actionBtn, { flex: 1 }]}
          onPress={() => {
            WebBrowser.openBrowserAsync(BOT_URL).catch(() => flash(t('orders.tgFail')))
          }}
        >
          <T style={disp(11.5, 1, { ls: 0.1, upper: true })}>{t('orders.telegram')}</T>
        </Tap>
        <Tap style={styles.actionBtn} onPress={() => router.push('/studio')}>
          <T style={disp(11.5, 1, { ls: 0.1, upper: true })}>{t('orders.repeat')}</T>
        </Tap>
      </View>
    </Panel>
  )
}

function PastOrder({ order, t }: { order: Order; t: TFn }) {
  const cancelled = order.status === 'cancelled'
  const st = STATUSES[statusIndex(order.status)]
  const color = cancelled ? C.i55 : st.c
  return (
    <View style={styles.past}>
      <View style={styles.pastThumb}>
        <Image source={GARMENT_FLAT} style={styles.fill} resizeMode="contain" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T style={mono(9.5, 1, { ls: 0.18, upper: true, color: C.i38 })}>
          {`#LM-${order.id} · ${shortDate(order.created_at, t)}`}
        </T>
        <T style={[disp(14, 1.1), { marginTop: 3 }]} numberOfLines={1}>
          {summarizeDesign(order.design_json, t) || `${fmt(order.total_price)} ${t('common.sum')}`}
        </T>
      </View>
      <View style={[styles.statusChip, { borderColor: color }]}>
        <T style={monoSemi(9.5, 1, { ls: 0.12, upper: true, color })}>{statusLabel(order.status, t)}</T>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  fill: { width: '100%', height: '100%' },
  header: { flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: RULE, borderBottomColor: C.ink },
  thumb: { width: 66, height: 66, borderWidth: 1, borderColor: C.line, overflow: 'hidden', backgroundColor: C.white },
  statusChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  actions: { flexDirection: 'row', gap: 9, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 14 },
  actionBtn: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  past: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    padding: 14,
    marginBottom: 10,
    opacity: 0.72,
  },
  pastThumb: { width: 52, height: 52, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
})

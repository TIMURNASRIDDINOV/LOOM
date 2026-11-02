import React from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'

import { C } from '../../src/theme/tokens'
import { disp } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { BoxIcon } from '../../src/components/icons'
import { EmptyState, OfflineState, Skeleton, T, isOffline } from '../../src/components/ui'
import { OrderCard } from '../../src/components/account/OrderCard'
import { useRepeatOrder } from '../../src/components/account/useRepeatOrder'
import { fetchMyOrders, useAsync, useRefreshOnFocus } from '../../src/api/catalog'
import { useT } from '../../src/i18n'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

const BOT_URL = 'https://t.me/looom_design_bot'

// W30 orders, W32 empty. Newest first; the newest card is raised.
export default function Orders() {
  const router = useRouter()
  const t = useT()
  const { flash } = useToast()
  const { signedIn, loading: authLoading } = useAuth()
  const { repeat, busyId } = useRepeatOrder()
  const { data, loading, error, reload } = useAsync(
    () => (signedIn ? fetchMyOrders() : Promise.resolve([])),
    [signedIn],
  )
  useRefreshOnFocus(reload)

  const orders = data ?? []
  const waiting = authLoading || (signedIn && loading && !orders.length)

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar />
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!orders.length} onRefresh={reload} tintColor={C.coral} />}
      >
        <T style={disp(34, 1, { ls: -0.035 })}>{t('orders.title')}</T>

        {waiting ? (
          <>
            <Skeleton height={70} lines={['40%', '70%']} />
            <Skeleton height={70} lines={['40%', '70%']} />
          </>
        ) : !signedIn ? (
          <EmptyState
            icon={<BoxIcon size={32} width={1.8} />}
            title={t('acc.signInTitle')}
            body={t('orders.signIn')}
            action={t('common.signIn')}
            onAction={() => router.push('/login')}
          />
        ) : error ? (
          isOffline(error) ? (
            <OfflineState onRetry={reload} />
          ) : (
            <EmptyState
              icon={<BoxIcon size={32} width={1.8} />}
              title={t('orders.errTitle')}
              body={error.message}
              action={t('common.retry')}
              onAction={reload}
            />
          )
        ) : !orders.length ? (
          <EmptyState
            icon={<BoxIcon size={32} width={1.8} />}
            title={t('orders.empty')}
            action={t('orders.openStudio')}
            onAction={() => router.push('/studio')}
          />
        ) : (
          orders.map((o, i) => (
            <OrderCard
              key={o.id}
              order={o}
              raised={i === 0}
              repeating={busyId === o.id}
              onOpen={() => router.push({ pathname: '/order', params: { id: String(o.id) } })}
              onTelegram={() => WebBrowser.openBrowserAsync(BOT_URL).catch(() => flash(t('orders.tgFail')))}
              onRepeat={() => repeat(o.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24, gap: 16 },
})

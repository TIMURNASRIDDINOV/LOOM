import React, { useState } from 'react'
import { Alert, Image, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import Constants from 'expo-constants'

import { C, RULE, fmt } from '../../src/theme/tokens'
import { body, disp, mono, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ChevronRight } from '../../src/components/icons'
import { Button, Panel, T, Tap } from '../../src/components/ui'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

const SITE = 'https://loomdesign.uz'

export default function Account() {
  const router = useRouter()
  const { user, signedIn, isDesigner, phoneVerified, signOut, deleteAccount } = useAuth()
  const { flash } = useToast()
  const [deleting, setDeleting] = useState(false)

  if (!signedIn) {
    return (
      <View style={{ flex: 1 }}>
        <AppBar title="ПРОФИЛЬ" />
        <ScrollView contentContainerStyle={styles.page}>
          <T style={[disp(30, 0.98, { ls: -0.035 }), { marginBottom: 10 }]}>
            Войдите в аккаунт<T style={{ color: C.coral }}>/</T>
          </T>
          <T style={[body(14.5, 1.6, { color: C.i55 }), { marginBottom: 24 }]}>
            Вход через Telegram — быстро и без пароля. После входа появятся заказы, адрес доставки и
            кабинет дизайнера.
          </T>
          <Button title="Войти" variant="ink" size={12.5} vPad={16} onPress={() => router.push('/login')} />
          <About />
        </ScrollView>
      </View>
    )
  }

  const displayName = user?.name ?? user?.first_name ?? 'Профиль'
  const initial = displayName.trim().charAt(0).toUpperCase() || 'L'
  const ordersCount = user?.orders_count ?? 0

  const confirmDelete = () => {
    const run = async () => {
      setDeleting(true)
      try {
        await deleteAccount()
        flash('Аккаунт удалён')
        router.replace('/')
      } catch (e) {
        flash((e as Error).message)
      } finally {
        setDeleting(false)
      }
    }
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm('Удалить аккаунт? Личные данные будут стёрты, историю заказов восстановить нельзя.')) run()
      return
    }
    Alert.alert(
      'Удалить аккаунт?',
      'Личные данные будут стёрты безвозвратно. Оформленные заказы сохранятся у магазина как обезличенные записи.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: run },
      ],
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="ПРОФИЛЬ" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Tap style={styles.identity} onPress={() => router.push('/profile-edit')}>
          <View style={styles.avatar}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <T style={{ fontFamily: 'InterTight_800ExtraBold', fontSize: 24, color: C.white }}>{initial}</T>
            )}
          </View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <T style={disp(20, 1.1, { ls: -0.02 })} numberOfLines={1}>
              {displayName}
            </T>
            <T style={[mono(11.5, 1.3, { color: C.i55 }), { marginTop: 3 }]} numberOfLines={1}>
              {user?.phone ?? user?.email ?? '—'}
            </T>
            {isDesigner && user?.designer_handle ? (
              <View style={styles.designerChip}>
                <T style={monoSemi(9, 1, { ls: 0.12, upper: true, color: C.white })}>{`дизайнер · ${user.designer_handle}`}</T>
              </View>
            ) : null}
          </View>
          <ChevronRight />
        </Tap>

        {!phoneVerified ? (
          <Tap style={styles.notice} onPress={() => router.push('/login')}>
            <T style={[monoSemi(10, 1.4, { ls: 0.08, color: C.amber }), { flex: 1 }]}>
              Подтвердите номер через Telegram — без этого нельзя оформить заказ
            </T>
            <ChevronRight color={C.amber} />
          </Tap>
        ) : null}

        <View style={styles.stats}>
          <Stat label="Заказов" value={String(ordersCount)} />
          <Stat label="Потрачено" value={fmt(user?.total_spent ?? 0)} />
        </View>

        <Panel>
          <Row label="Мои заказы" trailing={String(ordersCount)} onPress={() => router.push('/orders')} />
          <Row
            label={isDesigner ? 'Кабинет дизайнера' : 'Стать дизайнером'}
            badge={isDesigner ? undefined : 'новое'}
            onPress={() => router.push('/publish')}
          />
          <Row
            label="Адрес доставки"
            trailing={addressOf(user?.location_preset) ?? 'не указан'}
            onPress={() => router.push('/profile-edit')}
          />
          <Row label="Личные данные" trailing="имя, телефон, фото" onPress={() => router.push('/profile-edit')} last />
        </Panel>

        <Panel style={{ marginTop: 14 }}>
          <Row label="Написать в поддержку" trailing="Telegram" onPress={() => open('https://t.me/looom_design_bot')} />
          <Row label="Условия и доставка" onPress={() => open(`${SITE}/privacy.html#terms`)} />
          <Row label="Политика конфиденциальности" onPress={() => open(`${SITE}/privacy.html`)} last />
        </Panel>

        <Button
          title="Выйти"
          variant="outline"
          size={12}
          vPad={15}
          style={{ marginTop: 16 }}
          onPress={async () => {
            await signOut()
            flash('Вы вышли из аккаунта')
            router.replace('/')
          }}
        />
        <Tap style={{ paddingVertical: 16, alignItems: 'center' }} onPress={deleting ? undefined : confirmDelete}>
          <T style={[body(12, 1.4, { color: C.deep }), { textDecorationLine: 'underline' }]}>
            {deleting ? 'Удаляем…' : 'Удалить аккаунт'}
          </T>
        </Tap>

        <About />
      </ScrollView>
    </View>
  )
}

function open(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => {})
}

function About() {
  const version = Constants.expoConfig?.version ?? '1.0.0'
  return (
    <T style={[mono(9.5, 1.6, { ls: 0.08, color: C.i38, align: 'center' }), { marginTop: 24 }]}>
      {`LOOM · версия ${version} · Ташкент`}
    </T>
  )
}

function addressOf(preset: string | null | undefined): string | null {
  if (!preset) return null
  try {
    const p = JSON.parse(preset) as { address?: string }
    return p.address ?? null
  } catch {
    return null
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <T style={monoSemi(9.5, 1, { ls: 0.16, upper: true, color: C.i55 })}>{label}</T>
      <T style={[disp(26, 1, { ls: -0.03 }), { marginTop: 4 }]}>{value}</T>
    </View>
  )
}

function Row({
  label,
  trailing,
  badge,
  onPress,
  last,
}: {
  label: string
  trailing?: string
  badge?: string
  onPress?: () => void
  last?: boolean
}) {
  return (
    <Tap style={[styles.row, last && { borderBottomWidth: 0 }]} onPress={onPress}>
      <T style={[disp(14.5, 1), { flex: 1 }]}>{label}</T>
      {badge ? (
        <View style={styles.badge}>
          <T style={monoSemi(9, 1, { ls: 0.12, upper: true, color: C.white })}>{badge}</T>
        </View>
      ) : null}
      {trailing ? (
        <T style={[mono(11, 1.3, { color: C.i38 }), { maxWidth: 130 }]} numberOfLines={1}>
          {trailing}
        </T>
      ) : null}
      <ChevronRight />
    </Tap>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 20,
    marginBottom: 16,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },
  avatar: {
    width: 60,
    height: 60,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  designerChip: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: C.ink },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(161,98,7,.3)',
    backgroundColor: 'rgba(161,98,7,.08)',
  },
  stats: { flexDirection: 'row', gap: 9, marginBottom: 16 },
  stat: { flex: 1, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, padding: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  badge: { paddingHorizontal: 5, paddingVertical: 3, backgroundColor: C.coral },
})

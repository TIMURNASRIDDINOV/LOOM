import React, { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, fmt } from '../../src/theme/tokens'
import { body, disp, mono, monoMed, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ChevronRight } from '../../src/components/icons'
import { Button, Panel, T, Tap } from '../../src/components/ui'
import { fetchMyOrders, useAsync } from '../../src/api/catalog'
import { useAuth } from '../../src/state/auth'
import { useToast } from '../../src/state/toast'

export default function Account() {
  const router = useRouter()
  const { user, signedIn, signOut } = useAuth()
  const { flash } = useToast()
  const [lang, setLang] = useState<'RU' | 'UZ' | 'EN'>('RU')
  const [theme, setTheme] = useState<'Светлая' | 'Тёмная' | 'Авто'>('Авто')

  const { data: orders } = useAsync(
    () => (signedIn ? fetchMyOrders() : Promise.resolve([])),
    [signedIn],
  )

  if (!signedIn) {
    return (
      <View style={{ flex: 1 }}>
        <AppBar title="ПРОФИЛЬ" />
        <ScrollView contentContainerStyle={styles.page}>
          <T style={[disp(30, 0.98, { ls: -0.035 }), { marginBottom: 10 }]}>
            Войдите в аккаунт<T style={{ color: C.coral }}>/</T>
          </T>
          <T style={[body(14.5, 1.6, { color: C.i55 }), { marginBottom: 24 }]}>
            Вход через Telegram — быстро и без пароля. После входа появятся заказы и адрес доставки.
          </T>
          <Button title="Войти" variant="ink" size={12.5} vPad={16} onPress={() => router.push('/login')} />
        </ScrollView>
      </View>
    )
  }

  const displayName = user?.name ?? user?.first_name ?? 'Профиль'
  const initial = displayName.trim().charAt(0).toUpperCase() || 'L'
  const ordersCount = user?.orders_count ?? orders?.length ?? 0

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="ПРОФИЛЬ" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <T style={{ fontFamily: 'InterTight_800ExtraBold', fontSize: 24, color: C.white }}>
              {initial}
            </T>
          </View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <T style={disp(20, 1.1, { ls: -0.02 })} numberOfLines={1}>
              {displayName}
            </T>
            <T style={[mono(11.5, 1.3, { color: C.i55 }), { marginTop: 3 }]} numberOfLines={1}>
              {user?.phone ?? user?.email ?? '—'}
            </T>
          </View>
        </View>

        <View style={styles.stats}>
          <Stat label="Заказов" value={String(ordersCount)} />
          <Stat label="Потрачено" value={fmt(user?.total_spent ?? 0)} />
        </View>

        <Panel>
          <Row label="Мои заказы" trailing={String(ordersCount)} onPress={() => router.push('/orders')} />
          <Row
            label="Мои работы"
            badge="дизайнер"
            onPress={() => router.push('/publish')}
          />
          <Row
            label="Адрес доставки"
            trailing={addressOf(user?.location_preset) ?? 'не указан'}
            onPress={() => router.push('/checkout')}
          />
          <Toggle
            label="Язык"
            options={['RU', 'UZ', 'EN']}
            value={lang}
            onChange={(v) => {
              setLang(v as typeof lang)
              flash('Язык интерфейса переключён')
            }}
          />
          <Toggle
            label="Тема"
            options={['Светлая', 'Тёмная', 'Авто']}
            value={theme}
            onChange={(v) => setTheme(v as typeof theme)}
            last
          />
        </Panel>

        <Button
          title="Выйти"
          variant="outline"
          size={12}
          vPad={15}
          style={{ marginTop: 16 }}
          textStyle={{ color: C.deep }}
          onPress={async () => {
            await signOut()
            flash('Вы вышли из аккаунта')
            router.replace('/')
          }}
        />
      </ScrollView>
    </View>
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
}: {
  label: string
  trailing?: string
  badge?: string
  onPress?: () => void
}) {
  return (
    <Tap style={styles.row} onPress={onPress}>
      <T style={[disp(14.5, 1), { flex: 1 }]}>{label}</T>
      {badge ? (
        <View style={styles.badge}>
          <T style={monoSemi(9, 1, { ls: 0.12, upper: true, color: C.white })}>{badge}</T>
        </View>
      ) : null}
      {trailing ? (
        <T style={[mono(11, 1.3, { color: C.i38 }), { maxWidth: 120 }]} numberOfLines={1}>
          {trailing}
        </T>
      ) : null}
      <ChevronRight />
    </Tap>
  )
}

function Toggle({
  label,
  options,
  value,
  onChange,
  last,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
  last?: boolean
}) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <T style={[disp(14.5, 1), { flex: 1 }]}>{label}</T>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {options.map((o) => {
          const on = o === value
          return (
            <Tap
              key={o}
              onPress={() => onChange(o)}
              style={[
                styles.pill,
                { backgroundColor: on ? C.ink : 'transparent', borderColor: on ? C.ink : C.line },
              ]}
            >
              <T style={monoMed(10.5, 1, { color: on ? C.paper : C.i55 })}>{o}</T>
            </Tap>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 20,
    marginBottom: 20,
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
  },
  stats: { flexDirection: 'row', gap: 9, marginBottom: 20 },
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
  pill: { paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1 },
})

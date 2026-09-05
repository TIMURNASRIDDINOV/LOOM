import React, { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'

import { C, RULE, fmt, noShadow, offset } from '../../src/theme/tokens'
import { body, disp, label as labelType, mono, monoMed, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Check, ChevronRight } from '../../src/components/icons'
import { MapPicker, type Pin } from '../../src/components/MapPicker'
import { Button, Panel, SlashTitle, T, Tap } from '../../src/components/ui'
import { ApiError, api } from '../../src/api/client'
import { fetchPaymentMethods, useAsync } from '../../src/api/catalog'
import { track } from '../../src/api/track'
import type { PaymentMethods } from '../../src/api/types'
import { useAuth } from '../../src/state/auth'
import { useCart } from '../../src/state/cart'
import { useToast } from '../../src/state/toast'

type Placed = { id: number; paymentUrl: string | null; method: PayMethod } | null
type PayMethod = keyof PaymentMethods

// Every method the checkout knows how to present. Which of them are offered is
// decided by the Worker (`GET /api/payments/methods`) — a provider appears the
// moment its merchant secrets are set, with no app release.
const PAY_LABELS: Record<PayMethod, { title: string; sub: string }> = {
  cod: { title: 'Наличными курьеру', sub: 'или картой при получении' },
  payme: { title: 'Payme', sub: 'оплата картой онлайн' },
  click: { title: 'Click', sub: 'оплата картой онлайн' },
  uzum: { title: 'Uzum Bank', sub: 'оплата картой онлайн' },
}
const PAY_ORDER: PayMethod[] = ['cod', 'payme', 'click', 'uzum']

export default function Checkout() {
  const router = useRouter()
  const { user, signedIn, phoneVerified, updateProfile } = useAuth()
  const cart = useCart()
  const { flash } = useToast()
  const { data: methods } = useAsync(fetchPaymentMethods, [])

  const [step, setStep] = useState(1)
  const [placed, setPlaced] = useState<Placed>(null)
  const [busy, setBusy] = useState(false)
  const [payMethod, setPayMethod] = useState<PayMethod>('cod')

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [street, setStreet] = useState('')
  const [entrance, setEntrance] = useState('')
  const [flat, setFlat] = useState('')
  const [floor, setFloor] = useState('')
  const [intercom, setIntercom] = useState('')
  const [pin, setPin] = useState<Pin | null>(null)

  useEffect(() => {
    if (user) {
      setName(user.name ?? user.first_name ?? '')
      setPhone(user.phone ?? '')
      // The web stores the last delivery pin on the profile.
      if (user.location_preset) {
        try {
          const p = JSON.parse(user.location_preset) as {
            address?: string
            lat?: number
            lng?: number
          }
          if (p.address) setStreet(p.address)
          if (typeof p.lat === 'number' && typeof p.lng === 'number') {
            setPin({ lat: p.lat, lng: p.lng, address: p.address })
          }
        } catch {
          // Malformed preset — the user types the address instead.
        }
      }
    }
  }, [user])

  const place = async () => {
    if (!signedIn) {
      flash('Войдите, чтобы оформить заказ')
      router.push('/login')
      return
    }
    if (!name.trim() || !phone.trim()) {
      setStep(1)
      flash('Заполните имя и телефон')
      return
    }
    if (!street.trim()) {
      setStep(2)
      flash('Укажите адрес доставки')
      return
    }

    if (!cart.items.length) {
      flash('Корзина пуста')
      router.replace('/cart')
      return
    }

    setBusy(true)
    try {
      // The server cart is what checkout reads, so push the local one first.
      await cart.sync()
      const res = await api<{ id: number; paymentUrl: string | null; paymentMethod: PayMethod }>('/api/cart/checkout', {
        method: 'POST',
        auth: true,
        body: {
          customerName: name.trim(),
          customerPhone: phone.trim(),
          address: street.trim(),
          // The courier app reads these; checkout used to send none because the
          // map was a drawing.
          addressLat: pin?.lat,
          addressLng: pin?.lng,
          addressDetails: {
            entrance: entrance.trim() || null,
            flat: flat.trim() || null,
            floor: floor.trim() || null,
            intercom: intercom.trim() || null,
          },
          paymentMethod: payMethod,
        },
      })
      cart.clear()
      track('cfg_order')
      // Remember the address for next time, like the web checkout does. Best
      // effort — the order is already placed.
      updateProfile({
        name: name.trim() || undefined,
        location_preset: { address: street.trim(), lat: pin?.lat, lng: pin?.lng },
      }).catch(() => {})
      setPlaced({ id: res.id, paymentUrl: res.paymentUrl ?? null, method: res.paymentMethod ?? payMethod })
      if (res.paymentUrl) WebBrowser.openBrowserAsync(res.paymentUrl).catch(() => {})
    } catch (e) {
      const err = e as ApiError
      if (err.code === 'phone_not_verified' || err.status === 403) {
        flash('Подтвердите номер через Telegram')
        router.push('/login')
      } else {
        flash(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (placed) {
    return (
      <View style={{ flex: 1 }}>
        <AppBar title="ЗАКАЗ" />
        <ScrollView contentContainerStyle={styles.page}>
          <SlashTitle size={30} style={{ marginBottom: 20 }}>
            Оформление
          </SlashTitle>
          <Panel raised raisedColor={C.coral} style={{ padding: 20, marginBottom: 18 }}>
            <T style={[monoSemi(10, 1, { ls: 0.22, upper: true, color: C.deep }), { marginBottom: 10 }]}>
              Заказ принят
            </T>
            <T style={[disp(30, 1, { ls: -0.03 }), { marginBottom: 6 }]}>{`#LM-${placed.id}`}</T>
            <T style={body(13, 1.6, { color: C.i55 })}>
              {placed.paymentUrl
                ? `Оплатите заказ в ${PAY_LABELS[placed.method].title} — страница оплаты открылась в браузере. Подтверждение придёт в Telegram.`
                : 'Подтверждение придёт в Telegram. Отслеживать можно во вкладке «Заказы».'}
            </T>
          </Panel>
          {placed.paymentUrl ? (
            <Button
              title={`Оплатить · ${PAY_LABELS[placed.method].title}`}
              vPad={16}
              style={{ marginBottom: 10 }}
              onPress={() => WebBrowser.openBrowserAsync(placed.paymentUrl!).catch(() => flash('Не удалось открыть оплату'))}
            />
          ) : null}
          <Button
            title="Отслеживать заказ"
            variant="ink"
            size={13}
            vPad={16}
            onPress={() => router.replace('/orders')}
          />
        </ScrollView>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <AppBar title="ЗАКАЗ" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <SlashTitle size={30} style={{ marginBottom: 20 }}>
          Оформление
        </SlashTitle>

        <Step
          n={1}
          title="Контакты"
          open={step === 1}
          summary={`${name || 'Имя'} · ${phone || '+998…'}`}
          onToggle={() => setStep(step === 1 ? 0 : 1)}
        >
          {phoneVerified ? (
            <View style={styles.verified}>
              <Check size={14} />
              <T style={monoMed(11.5, 1.3, { color: C.green })}>Номер подтверждён через Telegram</T>
            </View>
          ) : (
            <Tap style={styles.unverified} onPress={() => router.push('/login')}>
              <T style={monoMed(11.5, 1.3, { color: C.amber })}>
                Номер не подтверждён — войдите через Telegram
              </T>
              <ChevronRight color={C.amber} />
            </Tap>
          )}
          <Field label="Имя" value={name} onChange={setName} placeholder="Темурбек" />
          <Field
            label="Телефон"
            value={phone}
            onChange={setPhone}
            placeholder="+998 90 123-45-67"
            keyboard="phone-pad"
          />
        </Step>

        <Step
          n={2}
          title="Доставка"
          open={step === 2}
          summary={street || 'Адрес'}
          onToggle={() => setStep(step === 2 ? 0 : 2)}
        >
          <MapPicker
            value={pin}
            onChange={(next) => {
              setPin(next)
              // Reverse geocoding fills the field, but never clobbers an
              // address the user has already typed by hand.
              if (next.address && !street.trim()) setStreet(next.address)
            }}
          />
          <Field label="Адрес" value={street} onChange={setStreet} placeholder="Ташкент, ул. Навои 12" />
          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Field label="Подъезд" value={entrance} onChange={setEntrance} placeholder="2" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Квартира" value={flat} onChange={setFlat} placeholder="41" />
            </View>
          </View>
          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Field label="Этаж" value={floor} onChange={setFloor} placeholder="5" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Домофон" value={intercom} onChange={setIntercom} placeholder="—" />
            </View>
          </View>
        </Step>

        <Step
          n={3}
          title="Оплата"
          open={step === 3}
          summary={PAY_LABELS[payMethod].title}
          onToggle={() => setStep(step === 3 ? 0 : 3)}
        >
          <View style={{ gap: 9 }}>
            {PAY_ORDER.map((m) => {
              const live = m === 'cod' || !!methods?.[m]
              const on = payMethod === m
              // Unconfigured providers stay visible as «скоро» so the sheet does
              // not silently shrink between deployments — same rule as sign-in.
              if (!live && m === 'uzum') return null
              return (
                <Tap
                  key={m}
                  haptic
                  onPress={live ? () => setPayMethod(m) : undefined}
                  style={[
                    styles.payRow,
                    on ? offset(2, C.coral) : noShadow,
                    { borderColor: on ? C.ink : C.line, opacity: live ? 1 : 0.7 },
                  ]}
                >
                  <View style={on ? styles.radioOn : styles.radioOff} />
                  <View style={{ flex: 1 }}>
                    <T style={disp(14, 1, { color: live ? C.ink : C.i55 })}>{PAY_LABELS[m].title}</T>
                    <T style={[mono(9.5, 1.3, { color: C.i38 }), { marginTop: 3 }]}>{PAY_LABELS[m].sub}</T>
                  </View>
                  {!live ? (
                    <View style={styles.soon}>
                      <T style={mono(9, 1, { ls: 0.14, upper: true, color: C.amber })}>скоро</T>
                    </View>
                  ) : null}
                </Tap>
              )
            })}
          </View>
        </Step>

        <View style={styles.totalBar}>
          <View style={styles.totalRow}>
            <T style={monoSemi(9.5, 1.4, { ls: 0.16, upper: true, color: C.i55 })}>
              Итого · доставка бесплатно
            </T>
            <T style={disp(23, 1, { ls: -0.03 })}>{fmt(cart.total)} сум</T>
          </View>
          <Button title="Оформить заказ" vPad={17} loading={busy} onPress={place} />
          <T style={[body(10.5, 1.5, { color: C.i38, align: 'center' }), { marginTop: 11 }]}>
            Оформляя заказ, вы соглашаетесь с условиями доставки
          </T>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Step({
  n,
  title,
  open,
  summary,
  onToggle,
  children,
}: {
  n: number
  title: string
  open: boolean
  summary: string
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <View style={[styles.step, open ? offset(2, C.ink) : noShadow]}>
      <Tap style={[styles.stepHead, open && styles.stepHeadOpen]} onPress={onToggle}>
        <View style={[styles.stepNum, { backgroundColor: open ? C.coral : 'rgba(19,19,17,.1)' }]}>
          <T style={{ ...monoSemi(9.5, 1), color: open ? C.white : C.i55, fontFamily: 'IBMPlexMono_700Bold' }}>
            {`0${n}`}
          </T>
        </View>
        <T style={[disp(14, 1.1, { ls: -0.02 }), { flex: 1 }]}>{title}</T>
        {!open ? (
          <T style={[mono(10, 1.3, { color: C.i38 }), { maxWidth: 116 }]} numberOfLines={1}>
            {summary}
          </T>
        ) : null}
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <ChevronRight size={14} />
        </View>
      </Tap>
      {open ? <View style={{ padding: 13 }}>{children}</View> : null}
    </View>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboard,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  keyboard?: 'default' | 'phone-pad' | 'numeric'
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <T style={[labelType(9.5, { color: C.i70 }), { marginBottom: 6 }]}>{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.i38}
        keyboardType={keyboard ?? 'default'}
        style={styles.input}
        allowFontScaling={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 32 },

  step: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, marginBottom: 10 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  stepHeadOpen: { borderBottomWidth: RULE, borderBottomColor: C.ink, backgroundColor: C.paper },
  stepNum: { paddingHorizontal: 5, paddingVertical: 3 },

  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(21,128,61,.3)',
    backgroundColor: 'rgba(21,128,61,.08)',
  },
  unverified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(161,98,7,.3)',
    backgroundColor: 'rgba(161,98,7,.08)',
  },

  input: {
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: C.ink,
  },
  grid2: { flexDirection: 'row', gap: 9 },


  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderWidth: RULE,
  },
  radioOn: { width: 15, height: 15, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.coral },
  radioOff: { width: 15, height: 15, borderWidth: RULE, borderColor: C.i38 },
  soon: {
    marginLeft: 'auto',
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: 'rgba(161,98,7,.08)',
  },

  totalBar: { borderTopWidth: RULE, borderTopColor: C.ink, marginTop: 16, paddingTop: 14 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
})

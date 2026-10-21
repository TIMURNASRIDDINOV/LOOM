import React, { useEffect, useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'

import { C, F, HAIR, RULE, fmt, noShadow, offset } from '../../src/theme/tokens'
import { body, disp, kicker, mono, monoBold, monoSemi } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Check, ChevronRight } from '../../src/components/icons'
import { MapPicker, type Pin } from '../../src/components/MapPicker'
import { Button, Input, T, Tap } from '../../src/components/ui'
import { Heading } from '../../src/components/shop/Heading'
import { ApiError, api } from '../../src/api/client'
import { GARMENT_FLAT, fetchPaymentMethods, useAsync } from '../../src/api/catalog'
import { track } from '../../src/api/track'
import type { PaymentMethods } from '../../src/api/types'
import { useAuth } from '../../src/state/auth'
import { useCart } from '../../src/state/cart'
import { useStudio } from '../../src/state/studio'
import { useToast } from '../../src/state/toast'
import { statusLabel, useT, type TFn } from '../../src/i18n'
import type { StringKey } from '../../src/i18n/strings'

// W16 checkout, W17 order placed. Three numbered sections on one page; the
// placed state replaces the page (no tab bar). Only payment methods the Worker
// can complete right now are listed — no "coming soon" placeholders.

type PayMethod = keyof PaymentMethods
type Placed = {
  id: number
  paymentUrl: string | null
  method: PayMethod
  total: number
  address: string
  thumbs: (string | null)[]
}

function payLabels(t: TFn): Record<PayMethod, { title: string; sub: string }> {
  return {
    cod: { title: t('co.cod'), sub: t('co.codSub') },
    payme: { title: 'Payme', sub: t('co.onlineSub') },
    click: { title: 'Click', sub: t('co.onlineSub') },
    uzum: { title: 'Uzum Bank', sub: t('co.onlineSub') },
  }
}
const PAY_ORDER: PayMethod[] = ['cod', 'payme', 'click', 'uzum']

// Server refusal codes for a bag item that can no longer be sold (backend/src/lib/variant.ts).
const UNSOLD: Record<string, StringKey> = {
  product_unavailable: 'st.productUnavailable',
  size_unavailable: 'st.sizeUnavailable',
  color_unavailable: 'st.colorUnavailable',
  print_unavailable: 'st.blankNote',
}

export default function Checkout() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, signedIn, phoneVerified, updateProfile } = useAuth()
  const cart = useCart()
  const { repriceArtwork } = useStudio()
  const { flash } = useToast()
  const t = useT()
  const PAY_LABELS = payLabels(t)
  const { data: methods } = useAsync(fetchPaymentMethods, [])

  const [placed, setPlaced] = useState<Placed | null>(null)
  const [busy, setBusy] = useState(false)
  const [priceChanged, setPriceChanged] = useState(false)
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

  // Offered: cash always, an online provider only once the Worker has its secrets.
  const offered = PAY_ORDER.filter((m) => m === 'cod' || !!methods?.[m])

  const place = async () => {
    if (busy) return
    if (!signedIn) {
      flash(t('co.errSignIn'))
      router.push('/login')
      return
    }
    if (!name.trim() || !phone.trim()) {
      flash(t('co.errContacts'))
      return
    }
    if (!street.trim()) {
      flash(t('co.errAddress'))
      return
    }
    if (!cart.items.length) {
      flash(t('co.errEmpty'))
      router.replace('/cart')
      return
    }

    setPriceChanged(false)
    setBusy(true)
    track('cfg_checkout_submit', '/checkout')
    // What the placed page shows is what the shopper confirmed, taken before the cart empties.
    const summary = { total: cart.total, thumbs: cart.items.slice(0, 4).map((i) => i.image) }
    try {
      // The server cart is what checkout reads: send anything still waiting on the phone.
      try {
        await cart.sync()
      } catch {
        flash(t('co.errSync'))
        return
      }
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
      setPlaced({
        id: res.id,
        paymentUrl: res.paymentUrl ?? null,
        method: res.paymentMethod ?? payMethod,
        address: street.trim(),
        ...summary,
      })
      if (res.paymentUrl) WebBrowser.openBrowserAsync(res.paymentUrl).catch(() => {})
    } catch (e) {
      const err = e as ApiError
      if (err.code === 'price_changed' || err.code === 'artwork_price_changed') {
        // No order was made. Adding the studio design again then carries the new markup.
        const d = err.details
        if (typeof d?.artworkId === 'number' && typeof d.currentPrice === 'number') repriceArtwork(d.artworkId, d.currentPrice)
        setPriceChanged(true)
        flash(t('co.priceChanged'))
      } else if (err.code === 'phone_not_verified' || err.status === 403) {
        flash(t('co.errVerify'))
        router.push('/login')
      } else if (err.status === 401) {
        flash(t('co.errSignIn'))
        router.push('/login')
      } else if (err.code && err.code in UNSOLD) {
        // A bag item's product, size or colour was switched off (LOOM-166).
        flash(t(UNSOLD[err.code]))
      } else {
        flash(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // W17 — order placed.
  if (placed) {
    return (
      <View style={{ flex: 1 }}>
        <BackHeader close onBack={() => router.replace('/')} />
        <ScrollView contentContainerStyle={styles.placedPage} showsVerticalScrollIndicator={false}>
          <View style={[styles.tick, offset(3)]}>
            <Check size={44} color={C.ink} width={2.6} />
          </View>
          <View style={{ gap: 10 }}>
            <T style={kicker()}>{`#LM-${placed.id}`}</T>
            <Heading style={disp(34, 1, { ls: -0.035 })}>
              {t('co.accepted')}
            </Heading>
            <T style={body(16, 24 / 16, { color: C.i70 })}>
              {placed.paymentUrl
                ? t('co.payBody', { provider: PAY_LABELS[placed.method].title })
                : t('co.acceptedBody')}
            </T>
          </View>

          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {placed.thumbs.map((src, i) => (
                  <View key={i} style={styles.thumb}>
                    <Image source={src ? { uri: src } : GARMENT_FLAT} style={{ width: 42, height: 42 }} resizeMode="contain" />
                  </View>
                ))}
              </View>
              <View style={styles.status}>
                <View style={styles.statusDot} />
                <T style={monoBold(12, 16 / 12, { ls: 0.1, upper: true })}>{statusLabel('new', t)}</T>
              </View>
            </View>
            <View style={{ padding: 14, paddingTop: 12, gap: 8 }}>
              <Fact label={t('cart.total')} value={`${fmt(placed.total)} ${t('common.sum')}`} strong />
              <Fact label={t('co.payment')} value={PAY_LABELS[placed.method].title} />
              <Fact label={t('co.address')} value={placed.address} right />
            </View>
          </View>

          <View style={{ gap: 10 }}>
            {placed.paymentUrl ? (
              <Button
                title={t('co.payBtn', { provider: PAY_LABELS[placed.method].title })}
                onPress={() => WebBrowser.openBrowserAsync(placed.paymentUrl!).catch(() => flash(t('co.errPayOpen')))}
              />
            ) : null}
            <Button
              title={t('co.track')}
              variant={placed.paymentUrl ? 'ink' : 'primary'}
              onPress={() => router.replace(`/order?id=${placed.id}`)}
            />
            <Button title={t('tab.home')} variant="outline" style={{ backgroundColor: C.white }} onPress={() => router.replace('/')} />
          </View>
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
      <BackHeader title={t('bar.checkout')} onBack={() => router.replace('/cart')} />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: Math.max(insets.bottom, 12) + 28 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Heading style={disp(34, 1, { ls: -0.035 })}>
          {t('co.title')}
        </Heading>

        <Section n={1} title={t('co.contacts')}>
          <Input label={t('co.name')} value={name} onChangeText={setName} placeholder={t('login.namePh')} />
          <Input
            label={t('co.phone')}
            value={phone}
            onChangeText={setPhone}
            placeholder="+998 90 123 45 67"
            keyboardType="phone-pad"
            style={{ fontFamily: F.mono }}
          />
          {phoneVerified ? (
            <View style={styles.verified}>
              <View style={styles.tickSm}>
                <Check size={12} color={C.white} width={3.4} />
              </View>
              <T style={body(13, 18 / 13, { color: C.i70 })}>{t('co.verified')}</T>
            </View>
          ) : (
            <Tap accessibilityRole="button" style={styles.unverified} onPress={() => router.push('/login')}>
              <T style={[mono(12, 16 / 12, { color: C.amber }), { flex: 1 }]}>{t('co.unverified')}</T>
              <ChevronRight color={C.amber} />
            </Tap>
          )}
        </Section>

        <Section n={2} title={t('co.delivery')}>
          <MapPicker
            value={pin}
            onChange={(next) => {
              setPin(next)
              // Reverse geocoding fills the field, but never clobbers an
              // address the user has already typed by hand.
              if (next.address && !street.trim()) setStreet(next.address)
            }}
          />
          <Input label={t('co.address')} value={street} onChangeText={setStreet} placeholder={t('co.addressPh')} />
          <View style={styles.grid2}>
            <View style={styles.cell}>
              <Input label={t('co.entrance')} value={entrance} onChangeText={setEntrance} keyboardType="numeric" style={{ fontFamily: F.mono }} />
            </View>
            <View style={styles.cell}>
              <Input label={t('co.flat')} value={flat} onChangeText={setFlat} keyboardType="numeric" style={{ fontFamily: F.mono }} />
            </View>
            <View style={styles.cell}>
              <Input label={t('co.floor')} value={floor} onChangeText={setFloor} keyboardType="numeric" style={{ fontFamily: F.mono }} />
            </View>
            <View style={styles.cell}>
              <Input label={t('co.intercom')} value={intercom} onChangeText={setIntercom} style={{ fontFamily: F.mono }} />
            </View>
          </View>
        </Section>

        <Section n={3} title={t('co.payment')}>
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            {offered.map((m) => {
              const on = payMethod === m
              return (
                <Tap
                  key={m}
                  haptic
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setPayMethod(m)}
                  style={[styles.payRow, on ? offset(3, C.coral) : noShadow, { borderColor: on ? C.ink : 'rgba(19,19,17,.24)' }]}
                >
                  <View style={on ? styles.radioOn : styles.radioOff} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T style={disp(16, 20 / 16)}>{PAY_LABELS[m].title}</T>
                    <T style={body(13, 18 / 13, { color: C.i70 })}>{PAY_LABELS[m].sub}</T>
                  </View>
                </Tap>
              )
            })}
          </View>
        </Section>

        <View style={{ gap: 12 }}>
          <View style={styles.sum}>
            <T style={mono(12, 16 / 12, { ls: 0.06, color: C.i70 })}>{t('common.itemsN', { n: cart.count })}</T>
            <View style={styles.sumRow}>
              <T style={[disp(16, 1.2), { flex: 1 }]}>{t('co.total')}</T>
              <T style={monoBold(19, 1.2)}>{`${fmt(cart.total)} ${t('common.sum')}`}</T>
            </View>
          </View>
          {priceChanged ? (
            <View accessibilityRole="alert" style={styles.alert}>
              <T style={body(14, 20 / 14)}>{t('co.priceChanged')}</T>
              <Button title={t('cart.title')} variant="outline" style={{ backgroundColor: C.white }} onPress={() => router.replace('/cart')} />
            </View>
          ) : null}
          <Button title={t('co.place')} loading={busy} onPress={place} />
          <T style={body(12, 16 / 12, { color: C.i70, align: 'center' })}>{t('co.terms')}</T>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View accessibilityLabel={title} style={{ gap: 14 }}>
      <Heading style={[kicker(), styles.secHead]}>{`0${n} · ${title}`}</Heading>
      {children}
    </View>
  )
}

function Fact({ label, value, strong, right }: { label: string; value: string; strong?: boolean; right?: boolean }) {
  return (
    <View style={styles.fact}>
      <T style={body(14, 20 / 14, { color: C.i70 })}>{label}</T>
      <T style={[strong ? monoBold(14, 20 / 14) : body(14, 20 / 14), { flexShrink: 1 }, right && { textAlign: 'right' }]}>{value}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, gap: 28 },
  secHead: { paddingBottom: 6, borderBottomWidth: HAIR, borderBottomColor: C.line },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 12 },
  cell: { width: '47%', flexGrow: 1 },

  verified: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tickSm: { width: 18, height: 18, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  unverified: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: 'rgba(161,98,7,.3)',
    backgroundColor: 'rgba(161,98,7,.08)',
  },

  payRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: RULE,
    backgroundColor: C.white,
  },
  radioOn: { width: 18, height: 18, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.coral },
  radioOff: { width: 18, height: 18, borderWidth: RULE, borderColor: C.i38 },

  sum: { gap: 6, paddingHorizontal: 16, paddingVertical: 14, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  sumRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  alert: { gap: 12, padding: 14, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white, ...offset(3, C.coral) },

  placedPage: { paddingHorizontal: 16, paddingTop: 30, paddingBottom: 34, gap: 22 },
  tick: {
    width: 84,
    height: 84,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 12,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },
  thumb: {
    width: 48,
    height: 48,
    borderWidth: 1.5,
    borderColor: C.ink,
    backgroundColor: C.paper2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1.5,
    borderColor: C.ink,
  },
  statusDot: { width: 8, height: 8, backgroundColor: C.coral },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
})

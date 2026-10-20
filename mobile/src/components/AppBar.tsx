import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { C, RULE, offset } from '../theme/tokens'
import { disp, dispExtra, kicker as kickerType, mono } from '../theme/type'
import { ArrowLeft, Cart, Close } from './icons'
import { Badge, T, Tap, Wordmark } from './ui'
import { useT } from '../i18n'
import { goBack } from '../lib/nav'
import { useCart } from '../state/cart'

// The v2 top bars: 56px on a 2px ink rule, every control a 44×44 square with
// a hard-sm shadow (W09, W13, W14, W18).

function Square({
  label,
  onPress,
  children,
}: {
  label: string
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Tap accessibilityRole="button" accessibilityLabel={label} style={[styles.square, offset(2)]} onPress={onPress}>
      {children}
    </Tap>
  )
}

/**
 * The bar on tabbed screens: the wordmark on the left (or after a back square
 * with `onBack`, W37), the cart with its count on the right. `title=""` drops
 * the wordmark (W39).
 */
export function AppBar({ title = 'LOOM', onBack }: { title?: string; onBack?: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const t = useT()
  const { count } = useCart()

  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + 56, justifyContent: 'space-between' }]}>
      {onBack ? (
        <Square label={t('common.back')} onPress={onBack}>
          <ArrowLeft />
        </Square>
      ) : null}
      {title ? <Wordmark size={22} text={title} /> : null}
      <Square label={t('common.cart')} onPress={() => router.push('/cart')}>
        <Cart />
        {count > 0 ? <Badge count text={count} style={styles.count} /> : null}
      </Square>
    </View>
  )
}

/**
 * The bar on pushed screens (W14, W16, W31, W35): a back square — or a close
 * square with `close` (W23) — then the title, uppercase; with `kicker` the
 * title sits under an accent eyebrow (W18). `right` takes a cart, a quota chip
 * or a step meter.
 */
export function BackHeader({
  title,
  kicker,
  right,
  close,
  onBack,
}: {
  title?: string
  kicker?: string
  right?: React.ReactNode
  close?: boolean
  onBack?: () => void
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const t = useT()

  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + 56 }]}>
      <Square label={t(close ? 'common.close' : 'common.back')} onPress={onBack ?? (() => goBack(router))}>
        {close ? <Close size={20} width={2.4} /> : <ArrowLeft />}
      </Square>
      <View style={{ flex: 1, minWidth: 0 }}>
        {kicker ? <T style={kickerType(12, { ls: 0.22 })}>{kicker}</T> : null}
        {title ? (
          <T
            numberOfLines={1}
            style={kicker ? disp(17, 20 / 17, { ls: -0.01 }) : dispExtra(15, 1.2, { ls: 0.14, upper: true })}
          >
            {title}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  )
}

/**
 * Numbered steps under a header (W18 "1 Dizayn · 2 O‘lcham"): the current step
 * is ink with a 4px accent underline. Pass `onStep` to make steps tappable.
 */
export function StepHeader({
  steps,
  current,
  onStep,
}: {
  steps: string[]
  current: number
  onStep?: (index: number) => void
}) {
  return (
    <View style={styles.steps} accessibilityRole="tablist">
      {steps.map((s, i) => {
        const on = i === current
        return (
          <Tap
            key={s}
            disabled={!onStep}
            accessibilityRole="tab"
            aria-selected={on}
            onPress={() => onStep?.(i)}
            style={[styles.step, i > 0 && styles.stepRule]}
          >
            <View style={[styles.stepNum, on ? styles.stepNumOn : styles.stepNumOff]}>
              <T style={mono(12, 1, { color: on ? C.paper : C.i70 })}>{String(i + 1)}</T>
            </View>
            <T style={disp(14, 1, { ls: 0.08, upper: true, color: on ? C.ink : C.i70 })}>{s}</T>
            {on ? <View style={styles.stepCap} /> : null}
          </Tap>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    backgroundColor: C.paper,
  },
  square: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { position: 'absolute', top: -9, right: -9 },
  steps: {
    flexDirection: 'row',
    height: 46,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    backgroundColor: C.paper,
  },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  stepRule: { borderLeftWidth: RULE, borderLeftColor: C.ink },
  stepNum: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  stepNumOn: { backgroundColor: C.ink },
  stepNumOff: { borderWidth: RULE, borderColor: C.i70 },
  stepCap: { position: 'absolute', left: 0, right: 0, bottom: -RULE, height: 4, backgroundColor: C.coral },
})

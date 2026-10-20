import React, { useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { ApiError } from '../api/client'
import type { Artwork } from '../api/types'
import { useT } from '../i18n'
import { C, F, HAIR, RULE, fmt, noShadow, offset } from '../theme/tokens'
import { body, disp, dispSemi, label as labelType, mono, monoBold, monoSemi } from '../theme/type'
import { Minus, Plus, Refresh, WifiOff } from './icons'

// ─── Text ────────────────────────────────────────────────────────────────────

export function T({
  style,
  children,
  numberOfLines,
  onPress,
}: {
  style?: StyleProp<TextStyle>
  children?: React.ReactNode
  numberOfLines?: number
  /** For inline links inside a sentence, where a Pressable would break the flow. */
  onPress?: () => void
}) {
  return (
    <Text
      style={style}
      numberOfLines={numberOfLines}
      onPress={onPress}
      suppressHighlighting
      allowFontScaling={false}
    >
      {children}
    </Text>
  )
}

/** The LOOM wordmark — the coral slash is the brand's whole signature. */
export function Wordmark({ size = 16, text = 'LOOM' }: { size?: number; text?: string }) {
  return (
    <Text
      allowFontScaling={false}
      style={{
        fontFamily: 'InterTight_800ExtraBold',
        fontSize: size,
        lineHeight: size,
        letterSpacing: size * 0.06,
        textTransform: 'uppercase',
        color: C.ink,
      }}
    >
      {text}
      <Text style={{ color: C.coral }}>/</Text>
    </Text>
  )
}

/** A display heading that ends in the coral slash, e.g. «Корзина/». */
export function SlashTitle({
  children,
  size = 30,
  lh = 0.98,
  color = C.ink,
  style,
}: {
  children: string
  size?: number
  lh?: number
  color?: string
  style?: StyleProp<TextStyle>
}) {
  return (
    <Text allowFontScaling={false} style={[disp(size, lh, { ls: -0.035, color }), style]}>
      {children}
      <Text style={{ color: C.coral }}>/</Text>
    </Text>
  )
}

// ─── Surfaces ────────────────────────────────────────────────────────────────

/** The bordered white panel that carries almost every block in the design. */
export function Panel({
  children,
  style,
  raised,
  raisedColor = C.ink,
  size = 3,
}: {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  raised?: boolean
  raisedColor?: string
  size?: number
}) {
  return (
    <View
      style={[
        { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
        raised ? offset(size, raisedColor) : noShadow,
        style,
      ]}
    >
      {children}
    </View>
  )
}

export function Divider({ strong }: { strong?: boolean }) {
  return (
    <View
      style={{
        height: strong ? RULE : HAIR,
        backgroundColor: strong ? C.ink : C.line,
      }}
    />
  )
}

/**
 * The section head used across home and catalog: a mono eyebrow on the left,
 * an action on the right, sitting on a 2px rule.
 */
export function SectionHead({
  title,
  action,
  onAction,
}: {
  title: string
  action?: string
  onAction?: () => void
}) {
  return (
    <View style={styles.sectionHead}>
      <T style={labelType(12, { ls: 0.24, color: C.ink })}>{title}</T>
      {action ? (
        <Tap onPress={onAction} hitSlop={12}>
          <T style={mono(12, 1, { ls: 0.08, color: C.deep })}>{action}</T>
        </Tap>
      ) : null}
    </View>
  )
}

// ─── Pressables ──────────────────────────────────────────────────────────────

/** The pressed look, for showing a held state outside a press (the dev gallery). */
export const pressedStyle: ViewStyle = {
  transform: [{ translateX: 2 }, { translateY: 2 }],
  ...noShadow,
}

/**
 * Bare pressable with the v2 press: it moves 2px down-right and its hard
 * shadow collapses (W-Web-System). No fade, no ripple wash.
 */
export function Tap({
  style,
  children,
  haptic,
  onPress,
  ...rest
}: PressableProps & { style?: StyleProp<ViewStyle>; haptic?: boolean }) {
  return (
    <Pressable
      {...rest}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress?.(e)
      }}
      style={({ pressed }) => [style as ViewStyle, pressed && pressedStyle]}
    >
      {children}
    </Pressable>
  )
}

type BtnVariant = 'primary' | 'ink' | 'outline' | 'ghostInk'

/**
 * The v2 buttons (W-Web-System): 52px, 2px border, 2px hard shadow, Inter
 * Tight 700 13px uppercase at .14em. `Tap` supplies the press.
 *  · primary  — accent field with ink text (AA). The one CTA per screen.
 *  · ink      — solid ink.
 *  · outline  — transparent.
 *  · ghostInk — outline reversed out of an ink surface (the Lab block).
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  style,
  textStyle,
  disabled,
  loading,
  size = 13,
  vPad = 12,
}: {
  title: string
  onPress?: () => void
  variant?: BtnVariant
  icon?: React.ReactNode
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  disabled?: boolean
  loading?: boolean
  size?: number
  vPad?: number
}) {
  const v = {
    primary: { bg: C.coral, fg: C.ink, border: C.ink, shadow: offset(2, C.ink) },
    ink: { bg: C.ink, fg: C.paper, border: C.ink, shadow: offset(2, C.ink) },
    outline: { bg: 'transparent', fg: C.ink, border: C.ink, shadow: offset(2, C.ink) },
    ghostInk: { bg: 'transparent', fg: C.paper, border: C.paper, shadow: offset(3, C.paper) },
  }[variant]

  return (
    <Tap
      haptic
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      onPress={onPress}
      style={[
        styles.btn,
        { paddingVertical: vPad, backgroundColor: v.bg, borderColor: v.border },
        disabled ? styles.btnDisabled : v.shadow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : (
        <>
          {icon}
          <Text
            allowFontScaling={false}
            style={[
              // The 12px floor holds even where a caller still asks for less.
              disp(Math.max(size, 12), 1, { ls: 0.14, upper: true, color: v.fg }),
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </Tap>
  )
}

/** Segmented control: 2D/3D, Old/Orqa — 44px, ink fills the active half. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  hPad = 12,
  vPad = 0,
  fontSize = 13,
  style,
}: {
  options: { value: V; label: string }[]
  value: V
  onChange: (v: V) => void
  hPad?: number
  vPad?: number
  fontSize?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.segmented, offset(2), style]}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Tap
            key={o.value}
            haptic
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              { paddingHorizontal: hPad, paddingVertical: vPad, backgroundColor: on ? C.ink : C.white },
            ]}
          >
            <T style={disp(Math.max(fontSize, 12), 1, { color: on ? C.paper : C.i70 })}>{o.label}</T>
          </Tap>
        )
      })}
    </View>
  )
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Text field (W-Web-System): 52px, 2px ink border, hard-sm. Focus — or an
 * error — turns the border and a 3px shadow accent.
 */
export function Input({
  label,
  error,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & { label?: string; error?: string | null }) {
  const [focus, setFocus] = useState(false)
  const hot = focus || !!error
  return (
    <View style={{ gap: 6 }}>
      {label ? <T style={labelType(12, { color: hot ? C.deep : C.i70 })}>{label}</T> : null}
      <TextInput
        placeholderTextColor={C.i55}
        allowFontScaling={false}
        accessibilityLabel={label}
        {...rest}
        onFocus={(e) => {
          setFocus(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocus(false)
          onBlur?.(e)
        }}
        style={[styles.input, { borderColor: hot ? C.coral : C.ink }, hot ? offset(3, C.coral) : offset(2), style]}
      />
      {error ? <T style={body(13, 1.4, { color: C.deep })}>{error}</T> : null}
    </View>
  )
}

/** Filter chips (W10, W37): 44px, 2px ink; the active chip fills ink. */
export function ChipRow<V extends string | number | null>({
  options,
  value,
  onChange,
  scroll,
  style,
}: {
  options: { value: V; label: string }[]
  value: V
  onChange: (v: V) => void
  /** One sideways-scrolling line (W37) instead of wrapping (W10). */
  scroll?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const chips = options.map((o) => {
    const on = o.value === value
    return (
      <Tap
        key={String(o.value)}
        haptic
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onPress={() => onChange(o.value)}
        style={[styles.chip, { backgroundColor: on ? C.ink : C.white }]}
      >
        <T style={disp(13, 1, { ls: 0.06, color: on ? C.paper : C.ink })}>{o.label}</T>
      </Tap>
    )
  })
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={styles.chips}>
      {chips}
    </ScrollView>
  ) : (
    <View style={[styles.chips, { flexWrap: 'wrap' }, style]}>{chips}</View>
  )
}

/**
 * Size buttons (W13, W22): 56×44, ink fill when chosen. `unavailable` sizes
 * are struck through and disabled; `error` flags the row (size required).
 */
export function SizePicker({
  sizes,
  value,
  onChange,
  unavailable = [],
  error,
}: {
  sizes: readonly string[]
  value: string | null
  onChange: (size: string) => void
  unavailable?: readonly string[]
  error?: boolean
}) {
  return (
    <View style={styles.sizes} accessibilityRole="radiogroup">
      {sizes.map((z) => {
        const on = z === value
        const off = unavailable.includes(z)
        return (
          <Tap
            key={z}
            haptic
            disabled={off}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: off }}
            onPress={() => onChange(z)}
            style={[
              styles.size,
              { backgroundColor: on ? C.ink : C.white, borderColor: error ? C.coral : C.ink },
              off && styles.off,
            ]}
          >
            <T style={[disp(15, 1, { color: on ? C.paper : C.ink }), off && { textDecorationLine: 'line-through' }]}>
              {z}
            </T>
          </Tap>
        )
      })}
    </View>
  )
}

/** Garment colour button (W13, W18): 44×44 around a 28px chip; chosen = accent shadow. */
export function Swatch({
  hex,
  label,
  selected,
  disabled,
  onPress,
}: {
  hex: string
  /** The colour's name, for screen readers. */
  label: string
  selected?: boolean
  disabled?: boolean
  onPress?: () => void
}) {
  return (
    <Tap
      haptic
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: !!selected, disabled: !!disabled }}
      onPress={onPress}
      style={[
        styles.swatch,
        { borderColor: selected ? C.ink : 'rgba(19,19,17,.24)' },
        selected ? offset(3, C.coral) : noShadow,
        disabled && styles.off,
      ]}
    >
      <View style={[styles.swatchChip, { backgroundColor: hex }]} />
    </Tap>
  )
}

/** Quantity stepper (W14, W22): − value +, each button 44×44. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
}: {
  value: number
  onChange: (n: number) => void
  /** Pass 0 where − at 1 means "remove" (the cart). */
  min?: number
  max?: number
}) {
  const t = useT()
  return (
    <View style={styles.stepper}>
      <Tap
        haptic
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel={t('common.decrease')}
        onPress={() => onChange(value - 1)}
        style={[styles.stepBtn, value <= min && styles.off]}
      >
        <Minus />
      </Tap>
      <View style={styles.stepValue}>
        <T style={monoSemi(15, 1)}>{String(value)}</T>
      </View>
      <Tap
        haptic
        disabled={value >= max}
        accessibilityRole="button"
        accessibilityLabel={t('common.increase')}
        onPress={() => onChange(value + 1)}
        style={[styles.stepBtn, value >= max && styles.off]}
      >
        <Plus />
      </Tap>
    </View>
  )
}

// ─── Cards ───────────────────────────────────────────────────────────────────

/**
 * Accent tag — "tez orada" (W10), "bepul" (W37) — or, with `count`, the
 * bordered counter on the cart button. Mono 700 12px, ink on accent (AA).
 */
export function Badge({
  text,
  count,
  style,
}: {
  text: string | number
  count?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.badge, count && styles.badgeCount, style]}>
      <T style={monoBold(12, 4 / 3, count ? {} : { ls: 0.12, upper: true })}>{String(text)}</T>
    </View>
  )
}

/**
 * Marketplace artwork (W37, W39, the Home rail, the studio graphic tool): a
 * white tile with hard-sm, title and markup, author and sales. Size it from
 * outside (`style`), e.g. a half-width grid cell.
 */
export function ArtworkCard({
  artwork: a,
  onPress,
  onAuthor,
  style,
}: {
  artwork: Artwork
  onPress?: () => void
  onAuthor?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useT()
  return (
    <View style={[{ gap: 6 }, style]}>
      <Tap accessibilityRole="button" accessibilityLabel={a.title} onPress={onPress} style={[styles.artTile, offset(2)]}>
        <Image source={{ uri: a.image_url }} style={styles.artImg} resizeMode="contain" />
        {a.markup > 0 ? null : <Badge text={t('common.free')} style={styles.artBadge} />}
      </Tap>
      <View style={styles.artRow}>
        <T style={[dispSemi(15, 19 / 15), { flex: 1 }]} numberOfLines={1}>
          {a.title}
        </T>
        {a.markup > 0 ? <T style={monoSemi(12, 4 / 3)}>{t('mk.plus', { price: fmt(a.markup) })}</T> : null}
      </View>
      <View style={styles.artRow}>
        <Tap onPress={onAuthor} disabled={!onAuthor} style={styles.artAuthor}>
          <T style={mono(12, 4 / 3)} numberOfLines={1}>
            {a.author}
          </T>
        </Tap>
        {a.sold ? <T style={mono(12, 4 / 3, { color: C.i70 })}>{t('mk.soldN', { n: a.sold })}</T> : null}
      </View>
    </View>
  )
}

// ─── States ──────────────────────────────────────────────────────────────────

/**
 * Empty list (W15, W26, W32, W38): dashed panel, icon tile with an accent
 * shadow, a title, optional body and one accent action.
 */
export function EmptyState({
  title,
  body: text,
  icon,
  action,
  onAction,
  style,
}: {
  title: string
  body?: string
  icon?: React.ReactNode
  action?: string
  onAction?: () => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.empty, style]}>
      {icon ? <View style={[styles.stateIcon, { width: 64, height: 64 }, offset(3, C.coral)]}>{icon}</View> : null}
      <T style={disp(26, 1.05, { ls: -0.03 })}>{title}</T>
      {text ? <T style={body(15, 22 / 15, { color: C.i70 })}>{text}</T> : null}
      {action ? <Button title={action} onPress={onAction} style={{ alignSelf: 'stretch' }} /> : null}
    </View>
  )
}

/** Loading placeholder card (W11): a paper-2 image block over text bars. */
export function Skeleton({
  height = 146,
  lines = ['60%', '85%', '50%'],
  style,
}: {
  height?: number
  lines?: DimensionValue[]
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ gap: 10 }, style]}>
      <View style={[styles.skelBlock, { height }]} />
      {lines.map((w, i) => (
        <View key={i} style={[styles.skelBar, { width: w }]} />
      ))}
    </View>
  )
}

/** True when `api()` never reached the server — the offline case (W12). */
export function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0
}

/** No connection (W12): bordered card with a struck signal and an accent retry. */
export function OfflineState({
  onRetry,
  title,
  style,
}: {
  onRetry?: () => void
  title?: string
  style?: StyleProp<ViewStyle>
}) {
  const t = useT()
  return (
    <View accessibilityRole="alert" style={[styles.offline, offset(3), style]}>
      <View style={[styles.stateIcon, { width: 56, height: 56, backgroundColor: C.coral }]}>
        <WifiOff />
      </View>
      <T style={disp(24, 1.1, { ls: -0.025 })}>{title ?? t('common.offline')}</T>
      {onRetry ? (
        <Button title={t('common.retry')} icon={<Refresh />} onPress={onRetry} style={{ alignSelf: 'stretch' }} />
      ) : null}
    </View>
  )
}

// ─── Feedback ────────────────────────────────────────────────────────────────

/** Ink toast with a coral offset, floating above the tab bar. */
export function Toast({ message, bottom = 118 }: { message: string; bottom?: number }) {
  if (!message) return null
  return (
    <View pointerEvents="none" style={[styles.toast, { bottom }, offset(3, C.coral)]}>
      <T style={disp(13, 1.3, { color: C.paper, align: 'center' })}>{message}</T>
    </View>
  )
}

export function Spinner({ size = 44 }: { size?: number }) {
  return <ActivityIndicator size={size > 30 ? 'large' : 'small'} color={C.coral} />
}

/** Full-screen centred state for loading / error / empty. */
export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderWidth: RULE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  btnDisabled: { opacity: 0.45, ...noShadow },
  segmented: {
    flexDirection: 'row',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  segment: { minHeight: 44, minWidth: 52, alignItems: 'center', justifyContent: 'center' },
  input: {
    minHeight: 52,
    borderWidth: RULE,
    backgroundColor: C.white,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 16,
    color: C.ink,
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  size: { width: 56, height: 44, borderWidth: RULE, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.38 },
  swatch: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchChip: { width: 28, height: 28, borderWidth: 1.5, borderColor: C.i38 },
  stepper: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: RULE, borderColor: C.ink },
  stepBtn: { width: 44, height: 44, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  stepValue: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: RULE,
    borderRightWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  badge: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: C.coral },
  badgeCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    paddingVertical: 0,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artTile: {
    height: 140,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artImg: { width: 112, height: 112 },
  artBadge: { position: 'absolute', top: 6, left: 6 },
  artRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  artAuthor: { minHeight: 44, minWidth: 44, justifyContent: 'center', flexShrink: 1 },
  empty: {
    gap: 18,
    paddingTop: 28,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderWidth: RULE,
    borderStyle: 'dashed',
    borderColor: 'rgba(19,19,17,.4)',
    backgroundColor: C.white,
    alignItems: 'flex-start',
  },
  stateIcon: {
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skelBlock: { borderWidth: RULE, borderColor: 'rgba(19,19,17,.12)', backgroundColor: C.paper2 },
  skelBar: { height: 12, backgroundColor: C.paper2 },
  offline: {
    gap: 16,
    paddingTop: 24,
    paddingHorizontal: 18,
    paddingBottom: 20,
    marginRight: 3,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'flex-start',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
    marginHorizontal: 18,
    marginBottom: 14,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 90,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: C.ink,
    borderWidth: RULE,
    borderColor: C.ink,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
  },
})

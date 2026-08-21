import React from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { C, HAIR, RULE, noShadow, offset } from '../theme/tokens'
import { disp, label as labelType, mono } from '../theme/type'

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
        letterSpacing: size * 0.14,
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
 * an action on the right, sitting on a 1.5px rule.
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
      <T style={labelType(10.5, { ls: 0.24, color: C.ink })}>{title}</T>
      {action ? (
        <Tap onPress={onAction} hitSlop={12}>
          <T style={mono(11, 1, { ls: 0.08, color: C.deep })}>{action}</T>
        </Tap>
      ) : null}
    </View>
  )
}

// ─── Pressables ──────────────────────────────────────────────────────────────

/** Bare pressable with the design's press feedback (opacity, no ripple wash). */
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
      style={({ pressed }) => [style as ViewStyle, pressed && { opacity: 0.62 }]}
    >
      {children}
    </Pressable>
  )
}

type BtnVariant = 'primary' | 'ink' | 'outline' | 'ghostInk'

/**
 * The four button shapes in the design.
 *  · primary  — coral fill, 3px hard offset. The one CTA per screen.
 *  · ink      — ink fill, 2–3px offset. Secondary confirm.
 *  · outline  — hairline box, transparent. Tertiary.
 *  · ghostInk — outline reversed out of an ink surface.
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
  size = 17,
  vPad = 16,
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
    primary: { bg: C.coral, fg: C.white, border: C.ink, shadow: offset(3, C.ink) },
    ink: { bg: C.ink, fg: C.paper, border: C.ink, shadow: offset(2, C.ink) },
    outline: { bg: 'transparent', fg: C.ink, border: C.ink, shadow: noShadow },
    ghostInk: { bg: 'transparent', fg: C.paper, border: C.paper, shadow: offset(3, C.paper) },
  }[variant]

  const isBig = size >= 15
  return (
    <Tap
      haptic
      onPress={disabled || loading ? undefined : onPress}
      style={[
        styles.btn,
        {
          paddingVertical: vPad,
          backgroundColor: v.bg,
          borderColor: v.border,
          opacity: disabled ? 0.45 : 1,
        },
        v.shadow,
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
              disp(size, 1, {
                ls: isBig ? 0.04 : 0.14,
                upper: true,
                color: v.fg,
              }),
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

/** Segmented control: 2D/3D, Перед/Зад — ink fills the active half. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  hPad = 14,
  vPad = 9,
  fontSize = 12,
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
    <View style={[styles.segmented, style]}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Tap
            key={o.value}
            haptic
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: hPad,
              paddingVertical: vPad,
              backgroundColor: on ? C.ink : C.white,
            }}
          >
            <T style={disp(fontSize, 1, { color: on ? C.paper : C.ink })}>{o.label}</T>
          </Tap>
        )
      })}
    </View>
  )
}

// ─── Feedback ────────────────────────────────────────────────────────────────

/** Ink toast with a coral offset, floating above the tab bar. */
export function Toast({ message, bottom = 118 }: { message: string; bottom?: number }) {
  if (!message) return null
  return (
    <View pointerEvents="none" style={[styles.toast, { bottom }, offset(3, C.coral)]}>
      <T style={disp(12.5, 1.3, { color: C.paper, align: 'center' })}>{message}</T>
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
    borderWidth: RULE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
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

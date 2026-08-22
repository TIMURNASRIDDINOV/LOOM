import React from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { C, RULE } from '../theme/tokens'
import { mono } from '../theme/type'
import { Discord, Facebook, Google, Mail, Telegram } from './icons'
import { T, Tap } from './ui'

// One row shape for every sign-in provider: a glyph, a label, and an optional
// «скоро» tail when the Worker has no credentials for it yet. Google and
// Telegram sit above the fold; the rest live behind the 3-dots row.

export type SocialKind = 'google' | 'facebook' | 'discord' | 'telegram' | 'email'

const GLYPH: Record<SocialKind, React.ReactNode> = {
  google: <Google />,
  facebook: <Facebook />,
  discord: <Discord />,
  telegram: <Telegram color={C.white} />,
  email: <Mail />,
}

const LABEL: Record<SocialKind, string> = {
  google: 'Продолжить через Google',
  facebook: 'Продолжить через Facebook',
  discord: 'Продолжить через Discord',
  telegram: 'Продолжить через Telegram',
  email: 'Войти по email',
}

export function SocialButton({
  kind,
  onPress,
  disabled,
  busy,
  label,
}: {
  kind: SocialKind
  onPress?: () => void
  /** Set when the deployment has no client id/secret for this provider. */
  disabled?: boolean
  busy?: boolean
  label?: string
}) {
  // Telegram keeps its brand fill — it is the primary path for ordering, since
  // only it produces the verified phone the backend requires.
  const brandFilled = kind === 'telegram'

  return (
    <Tap
      haptic
      onPress={disabled || busy ? undefined : onPress}
      style={[
        styles.row,
        brandFilled && { backgroundColor: C.telegram, borderColor: C.telegram },
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.glyph}>{busy ? <ActivityIndicator size="small" /> : GLYPH[kind]}</View>
      <T
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 13.5,
          color: brandFilled ? C.white : disabled ? C.i38 : C.ink,
        }}
      >
        {label ?? LABEL[kind]}
      </T>
      {disabled ? (
        <View style={styles.soon}>
          <T style={mono(8.5, 1, { ls: 0.14, upper: true, color: C.amber })}>скоро</T>
        </View>
      ) : null}
    </Tap>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    marginBottom: 9,
  },
  glyph: { width: 20, alignItems: 'center', justifyContent: 'center' },
  disabled: { borderColor: C.line, backgroundColor: 'transparent' },
  soon: {
    marginLeft: 'auto',
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: 'rgba(161,98,7,.08)',
  },
})

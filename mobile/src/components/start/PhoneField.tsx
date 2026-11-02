import React, { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { C, F, RULE, offset } from '../../theme/tokens'
import { body, label as labelType } from '../../theme/type'
import { T } from '../ui'

/**
 * `90 123 45 67`: the nine national digits, grouped 2-3-2-2. A full number,
 * pasted or typed (`+998 90 123 45 67`), loses its country code, so the +998
 * cell never doubles up: a national number is nine digits, so a tenth digit
 * after a leading 998 can only be the country code. Further digits are dropped.
 */
export function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.length > 9 && d.startsWith('998')) d = d.slice(3)
  d = d.slice(0, 9)
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ')
}

/** The sign-in phone field (W06): +998 cell, 52px, focus or error turns it accent like `Input`. */
export function PhoneField({
  label,
  value,
  onChange,
  error,
  onSubmit,
  placeholder = '90 123 45 67',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  onSubmit?: () => void
  placeholder?: string
}) {
  const [focus, setFocus] = useState(false)
  const hot = focus || !!error
  return (
    <View style={{ gap: 6 }}>
      <T style={labelType(12, { color: hot ? C.deep : C.i70 })}>{label}</T>
      <View style={[styles.field, { borderColor: hot ? C.coral : C.ink }, hot ? offset(3, C.coral) : offset(2)]}>
        <View style={styles.prefix}>
          <T style={{ fontFamily: F.monoSemi, fontSize: 15, color: C.ink }}>+998</T>
        </View>
        <TextInput
          value={value}
          onChangeText={(v) => onChange(formatPhone(v))}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={C.i55}
          keyboardType="phone-pad"
          autoComplete="tel-national"
          accessibilityLabel={`${label} +998`}
          allowFontScaling={false}
          style={styles.input}
        />
      </View>
      {error ? <T style={body(13, 1.4, { color: C.deep })}>{error}</T> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 52,
    borderWidth: RULE,
    backgroundColor: C.white,
  },
  prefix: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRightWidth: RULE,
    borderRightColor: C.ink,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    fontFamily: F.mono,
    fontSize: 16,
    color: C.ink,
  },
})

import React, { useState } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import type { ArtworkCategory } from '../../api/types'
import { useI18n } from '../../i18n'
import { C, F, RULE, offset } from '../../theme/tokens'
import { body, label as labelType, mono, monoSemi } from '../../theme/type'
import { Check } from '../icons'
import { Button, T, Tap } from '../ui'
import { ChevronDown } from './glyphs'

/**
 * A text field with a fixed mark on one side — "@" before a handle (W40), "so‘m"
 * after a markup (W43). Same box as `Input` (52px, 2px ink, hard-sm; focus or an
 * error turns it accent), plus the rule line the designs keep under the field.
 */
export function AffixField({
  label,
  prefix,
  suffix,
  hint,
  error,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & { label: string; prefix?: string; suffix?: string; hint?: string; error?: string | null }) {
  const [focus, setFocus] = useState(false)
  const hot = focus || !!error
  return (
    <View style={{ gap: 6 }}>
      <T style={labelType(12, { color: hot ? C.deep : C.i70 })}>{label}</T>
      <View style={[styles.box, { borderColor: hot ? C.coral : C.ink }, hot ? offset(3, C.coral) : offset(2)]}>
        {prefix ? <T style={[monoSemi(16, 1, { color: C.i70 }), styles.prefix]}>{prefix}</T> : null}
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
          style={[styles.field, { paddingLeft: prefix ? 0 : 14 }, style]}
        />
        {suffix ? (
          <View style={styles.suffix}>
            <T style={mono(14, 1, { color: C.i70 })}>{suffix}</T>
          </View>
        ) : null}
      </View>
      {error ? (
        <T style={body(12, 16 / 12, { color: C.deep })}>{error}</T>
      ) : hint ? (
        <T style={body(12, 16 / 12, { color: C.i70 })}>{hint}</T>
      ) : null}
    </View>
  )
}

/**
 * The category dropdown of the details step (W43): a 52px button that opens an
 * inline list of the active categories. Mirrors the web upload form's rules —
 * only active categories can be chosen, and a failed load can be retried.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: { data: ArtworkCategory[] | null; error: Error | null; reload: () => void }
  value: number | null
  onChange: (id: number) => void
}) {
  const { lang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const options = (categories.data ?? []).filter((c) => c.active).map((c) => ({ id: c.id, label: c[`name_${lang}`] }))
  const chosen = options.find((o) => o.id === value)

  return (
    <View style={{ gap: 6 }}>
      <T style={labelType(12)}>{t('cat.label')}</T>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={`${t('cat.label')}: ${chosen?.label ?? t('pub.catPick')}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={[styles.select, offset(2)]}
      >
        <T style={body(16, 1.3, { color: chosen ? C.ink : C.i70 })} numberOfLines={1}>
          {chosen?.label ?? t('pub.catPick')}
        </T>
        <View style={open ? { transform: [{ rotate: '180deg' }] } : null}>
          <ChevronDown />
        </View>
      </Tap>
      {open ? (
        <View style={styles.list} accessibilityRole="radiogroup">
          {options.map((o, i) => (
            <Tap
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: o.id === value }}
              onPress={() => {
                onChange(o.id)
                setOpen(false)
              }}
              style={[styles.option, i > 0 && styles.optionRule, o.id === value && { backgroundColor: C.paper2 }]}
            >
              <T style={body(16, 1.3)} numberOfLines={1}>
                {o.label}
              </T>
              {o.id === value ? <Check color={C.ink} size={18} /> : null}
            </Tap>
          ))}
        </View>
      ) : null}
      {categories.error ? (
        <View style={{ gap: 8 }}>
          <T style={body(12, 16 / 12, { color: C.deep })}>{t('cat.failed')}</T>
          <Button title={t('cat.retry')} onPress={categories.reload} variant="outline" />
        </View>
      ) : !categories.data ? (
        <T style={body(12, 16 / 12, { color: C.i70 })}>{t('common.loading')}</T>
      ) : !options.length ? (
        <T style={body(12, 16 / 12, { color: C.i70 })}>{t('cat.none')}</T>
      ) : (
        <T style={body(12, 16 / 12, { color: C.i70 })}>{t('cat.choose')}</T>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 52,
    borderWidth: RULE,
    backgroundColor: C.white,
  },
  prefix: { alignSelf: 'center', paddingLeft: 14, paddingRight: 4 },
  field: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
    fontFamily: F.mono,
    fontSize: 16,
    color: C.ink,
    // The box carries the focus state; no second ring from the browser.
    outlineWidth: 0,
  },
  suffix: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderLeftWidth: RULE,
    borderLeftColor: C.line,
  },
  select: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  list: { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
  },
  optionRule: { borderTopWidth: 1, borderTopColor: C.line },
})

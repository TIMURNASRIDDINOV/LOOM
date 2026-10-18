import React from 'react'
import { ScrollView, View } from 'react-native'
import type { ArtworkCategory } from '../api/types'
import { useI18n } from '../i18n'
import { C, RULE } from '../theme/tokens'
import { body } from '../theme/type'
import { T, Tap } from './ui'

export function ArtworkCategories({ items, value, onChange, all = false }: {
  items: ArtworkCategory[]
  value: number | null
  onChange: (id: number | null) => void
  all?: boolean
}) {
  const { lang, t } = useI18n()
  const choices = [
    ...(all ? [{ id: null, label: t('cat.all') }] : []),
    ...items.filter((cat) => all || cat.active).map((cat) => ({ id: cat.id, label: cat[`name_${lang}`] })),
  ]
  return <View style={{ marginBottom: 16 }}>
    <T style={[body(13), { marginBottom: 8 }]}>{t(all ? 'cat.label' : 'cat.choose')}</T>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {choices.map((cat) => <Tap key={cat.id ?? 'all'} accessibilityRole="radio"
        accessibilityState={{ checked: cat.id === value }} onPress={() => onChange(cat.id)}
        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: RULE, borderColor: C.ink, backgroundColor: cat.id === value ? C.ink : C.paper }}>
        <T style={body(13, 1.4, { color: cat.id === value ? C.paper : C.ink })}>{cat.label}</T>
      </Tap>)}
    </ScrollView>
  </View>
}

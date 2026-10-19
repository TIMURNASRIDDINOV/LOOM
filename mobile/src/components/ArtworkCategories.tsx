import React from 'react'
import { ScrollView, View } from 'react-native'
import type { ArtworkCategory } from '../api/types'
import { useI18n } from '../i18n'
import { C, RULE } from '../theme/tokens'
import { body } from '../theme/type'
import { Button, T, Tap } from './ui'

export function ArtworkCategories({ categories, value, onChange, all = false }: {
  categories: { data: ArtworkCategory[] | null; error: Error | null; reload: () => void }
  value: number | null
  onChange: (id: number | null) => void
  all?: boolean
}) {
  const { lang, t } = useI18n()
  const choices = [
    ...(all ? [{ id: null, label: t('cat.all') }] : []),
    ...(categories.data ?? []).filter((cat) => all || cat.active).map((cat) => ({ id: cat.id, label: cat[`name_${lang}`] })),
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
    {categories.error ? <View style={{ marginTop: 8, gap: 8 }}>
      <T style={body(13)}>{t('cat.failed')}</T>
      <Button title={t('cat.retry')} onPress={categories.reload} variant="outline" />
    </View> : !categories.data ? <T style={[body(13, 1.4, { color: C.i55 }), { marginTop: 8 }]}>{t('common.loading')}</T>
      : !choices.length ? <T style={[body(13), { marginTop: 8 }]}>{t('cat.none')}</T> : null}
  </View>
}

import React, { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE } from '../../src/theme/tokens'
import { body, disp, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { ChevronRight } from '../../src/components/icons'
import { ChipRow, EmptyState, OfflineState, Skeleton, T, Tap, isOffline } from '../../src/components/ui'
import { Heading } from '../../src/components/shop/Heading'
import { ProductCard, ProductGrid, cellStyle } from '../../src/components/shop/ProductCard'
import { SectionHeading } from '../../src/components/shop/SectionHeading'
import { fetchProducts, useAsync } from '../../src/api/catalog'
import type { Product } from '../../src/api/types'
import { useI18n } from '../../src/i18n'

type Tab = 'all' | 'custom' | 'ready'

// W10 catalog, W11 loading, W12 offline. Every card opens the product page
// (W13), which carries the studio and cart actions.

export default function Catalog() {
  const [tab, setTab] = useState<Tab>('all')
  const router = useRouter()
  const { t } = useI18n()
  const { data, loading, error, reload } = useAsync(fetchProducts, [])

  const products = data ?? []
  const custom = products.filter((p) => (p.product_type ?? 'custom') === 'custom')
  const blank = products.filter((p) => p.product_type === 'blank')
  const ready = products.filter((p) => p.product_type === 'ready')

  const grid = (items: Product[]) => (
    <ProductGrid>
      {items.map((p) => (
        <ProductCard key={p.id} product={p} index={products.indexOf(p) + 1} onPress={() => router.push(`/product?id=${p.id}`)} />
      ))}
    </ProductGrid>
  )

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="LOOM" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 8 }}>
          <Heading style={disp(34, 1, { ls: -0.035 })}>
            {t('catalog.title')}
          </Heading>
          <T style={body(14, 20 / 14, { color: C.i70 })}>{t('catalog.subtitle')}</T>
        </View>

        {error && !data ? (
          // W12 — no connection; any other failure gets the same card with its own words.
          <>
            {isOffline(error) ? (
              <OfflineState onRetry={reload} />
            ) : (
              <EmptyState title={t('catalog.loadFailed')} action={t('common.retry')} onAction={reload} />
            )}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.ghosts}>
              <View style={styles.ghost} />
              <View style={styles.ghost} />
            </View>
          </>
        ) : (
          <>
            <ChipRow
              value={tab}
              onChange={setTab}
              options={[
                { value: 'all' as Tab, label: t('catalog.all') },
                { value: 'custom' as Tab, label: t('catalog.custom') },
                { value: 'ready' as Tab, label: t('catalog.ready') },
              ]}
            />

            {loading && !data ? (
              // W11 — skeleton cards while the catalog loads.
              <View accessibilityRole="progressbar" accessibilityLabel={t('common.loading')} style={{ gap: 16 }}>
                <T style={monoSemi(12, 16 / 12, { ls: 0.14, upper: true, color: C.i70 })}>{t('common.loading')}</T>
                <ProductGrid muted>
                  {[146, 146, 110, 110].map((h, i) => (
                    <View key={i} style={cellStyle(true)}>
                      <Skeleton height={h} lines={h === 146 ? ['60%', '85%', '50%'] : ['55%']} />
                    </View>
                  ))}
                </ProductGrid>
              </View>
            ) : (
              <>
                {tab !== 'ready' && custom.length > 0 ? (
                  <Section title={t('catalog.customSection')} note={t('catalog.customNote')}>
                    {grid(custom)}
                  </Section>
                ) : null}
                {tab === 'all' && blank.length > 0 ? (
                  <Section title={t('common.noPrint')} note={t('st.blankNote')}>
                    {grid(blank)}
                  </Section>
                ) : null}
                {tab !== 'custom' ? (
                  <Section title={t('catalog.readySection')} note={ready.length ? t('catalog.readyNote') : undefined}>
                    {ready.length ? (
                      grid(ready)
                    ) : (
                      // No ready-made designs yet: send shoppers to the designers' works instead.
                      <Tap accessibilityRole="link" onPress={() => router.push('/market')} style={styles.marketRow}>
                        <T style={[disp(15, 1.2, { ls: -0.01 }), { flex: 1 }]}>{t('catalog.marketRow')}</T>
                        <ChevronRight size={18} color={C.ink} width={2.4} />
                      </Tap>
                    )}
                  </Section>
                ) : null}
                {products.length === 0 ? (
                  <T style={body(14, 20 / 14, { color: C.i70 })}>{t('catalog.empty')}</T>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeading title={title} note={note} />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24, gap: 16 },
  ghosts: { flexDirection: 'row', gap: 14, opacity: 0.6 },
  ghost: { flex: 1, height: 150, borderWidth: RULE, borderStyle: 'dashed', borderColor: 'rgba(19,19,17,.3)' },
  marketRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderWidth: RULE,
    borderStyle: 'dashed',
    borderColor: 'rgba(19,19,17,.4)',
    backgroundColor: C.white,
  },
})

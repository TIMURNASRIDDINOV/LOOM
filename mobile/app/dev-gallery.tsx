import React, { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Redirect } from 'expo-router'

import { C, RULE } from '../src/theme/tokens'
import { body, disp, dispExtra, kicker, label, mono } from '../src/theme/type'
import { AppBar, BackHeader, StepHeader } from '../src/components/AppBar'
import * as Icons from '../src/components/icons'
import {
  ArtworkCard,
  Badge,
  Button,
  ChipRow,
  EmptyState,
  Input,
  OfflineState,
  Segmented,
  SizePicker,
  Skeleton,
  Stepper,
  Swatch,
  T,
  pressedStyle,
} from '../src/components/ui'
import type { Artwork } from '../src/api/types'
import { useLabEnabled } from '../src/lib/flags'

// Dev-only gallery of the v2 shared components in every state (LOOM-246), for
// checking them against W-Web-System at 390×844 on Expo web: /dev-gallery.
// Release builds redirect home. Labels here are for developers, not shoppers,
// so they stay in English and out of the dictionaries.

const art = (over: Partial<Artwork>): Artwork => ({
  id: 1,
  category_id: null,
  title: 'Toshkent xaritasi',
  tags: null,
  markup: 0,
  width: null,
  height: null,
  image_url: 'https://loomdesign.uz/images/icon-512.png',
  image_key: '',
  author: '@loom',
  sold: 24,
  created_at: 0,
  ...over,
})

export default function DevGallery() {
  if (!__DEV__) return <Redirect href="/" />
  return <Gallery />
}

function Section({ title, children, ink }: { title: string; children: React.ReactNode; ink?: boolean }) {
  return (
    <View style={[styles.section, ink && { backgroundColor: C.ink, padding: 18 }]}>
      <T style={kicker(12, ink ? { color: C.coral } : {})}>{title}</T>
      {children}
    </View>
  )
}

function Gallery() {
  const lab = useLabEnabled()
  const [seg, setSeg] = useState<'2d' | '3d'>('3d')
  const [chip, setChip] = useState<string>('all')
  const [size, setSize] = useState<string | null>('L')
  const [qty, setQty] = useState(1)
  const [step, setStep] = useState(0)

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <BackHeader title="Dev gallery" right={<Badge text={lab ? 'lab on' : 'lab off'} />} />
      <ScrollView contentContainerStyle={styles.page}>
        <Section title="Palette">
          <View style={styles.wrap}>
            {(['paper', 'paper2', 'white', 'ink', 'inactive', 'coral', 'deep', 'line'] as const).map((k) => (
              <View key={k} style={{ width: 76, gap: 4 }}>
                <View style={{ height: 48, backgroundColor: C[k], borderWidth: RULE, borderColor: C.ink }} />
                <T style={mono(12, 4 / 3, { color: C.i70 })}>{k}</T>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Type">
          <T style={disp(34, 1, { ls: -0.035 })}>So‘z bilan tasvirlang.</T>
          <T style={body(16, 1.5)}>Inter 16/24 — body copy.</T>
          <T style={kicker()}>kicker() · 12px</T>
          <T style={label()}>label() · 12px</T>
        </Section>

        <Section title="Buttons">
          <View style={styles.grid}>
            <Cell note="solid (ink)"><Button variant="ink" title="Buyurtma berish" /></Cell>
            <Cell note="outline"><Button variant="outline" title="Savatga" /></Cell>
            <Cell note="accent · ink text"><Button title="Keyingi →" /></Cell>
            <Cell note="pressed"><Button variant="ink" title="Buyurtma berish" style={pressedStyle} /></Cell>
            <Cell note="disabled"><Button title="Keyingi →" disabled /></Cell>
            <Cell note="loading"><Button variant="ink" title="Buyurtma berish" loading /></Cell>
          </View>
        </Section>

        <Section title="Ghost on ink" ink>
          <Button variant="ghostInk" title="Bu nima bo‘ladi →" style={{ minHeight: 44, alignSelf: 'flex-start' }} />
        </Section>

        <Section title="Segmented · chips">
          <Segmented value={seg} onChange={setSeg} options={[{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }]} style={{ alignSelf: 'flex-start' }} />
          <ChipRow
            value={chip}
            onChange={setChip}
            options={[{ value: 'all', label: 'Hammasi' }, { value: 'custom', label: 'Kastom' }, { value: 'ready', label: 'Tayyor' }]}
          />
          <ChipRow
            scroll
            value={chip}
            onChange={setChip}
            options={['all', 'Illyustratsiyalar', 'Yozuvlar', 'Abstraksiya', 'Tabiat', 'Madaniyat'].map((v) => ({ value: v, label: v === 'all' ? 'Barcha kategoriyalar' : v }))}
          />
        </Section>

        <Section title="Inputs">
          <Input label="Manzil" placeholder="Toshkent, Navoiy ko‘chasi 12" />
          <Input label="Ism · error" defaultValue="T" error="Ism kamida 2 harf" />
        </Section>

        <Section title="Size · swatch · stepper">
          <SizePicker sizes={['S', 'M', 'L', 'XL']} value={size} onChange={setSize} unavailable={['XL']} />
          <SizePicker sizes={['S', 'M', 'L']} value={null} onChange={setSize} error />
          <View style={styles.row}>
            <Swatch hex="#FFFFFF" label="Oq" selected />
            <Swatch hex="#000000" label="Qora" />
            <Swatch hex="#2b3e5e" label="To‘q ko‘k" disabled />
          </View>
          <View style={styles.row}>
            <Stepper value={qty} onChange={setQty} />
            <Stepper value={1} onChange={() => {}} min={0} />
          </View>
        </Section>

        <Section title="Badges · artwork cards">
          <View style={styles.row}>
            <Badge text="tez orada" />
            <Badge text="bepul" />
            <Badge count text={2} />
          </View>
          <View style={styles.row}>
            <ArtworkCard artwork={art({})} style={{ flex: 1 }} onAuthor={() => {}} />
            <ArtworkCard artwork={art({ id: 2, title: 'Anor naqshi', markup: 20000, sold: 12 })} style={{ flex: 1 }} />
          </View>
        </Section>

        <Section title="States">
          <EmptyState
            icon={<Icons.BoxIcon size={32} width={1.8} />}
            title="Hozircha buyurtmalar yo‘q."
            body="Ishlar moderator tekshiruvidan so‘ng paydo bo‘ladi."
            action="Studiyani ochish →"
          />
          <OfflineState onRetry={() => {}} />
          <View style={styles.row}>
            <Skeleton style={{ flex: 1 }} />
            <Skeleton style={{ flex: 1 }} height={110} lines={['55%']} />
          </View>
        </Section>

        <Section title="Headers">
          <View style={styles.frame}><AppBar /></View>
          <View style={styles.frame}><AppBar onBack={() => {}} /></View>
          <View style={styles.frame}><BackHeader title="Savatcha" onBack={() => {}} /></View>
          <View style={styles.frame}><BackHeader kicker="Studiya" title="Klassik futbolka" onBack={() => {}} /></View>
          <View style={styles.frame}>
            <BackHeader close title="LOOM Lab" onBack={() => {}} right={<Badge text="3 / 5" />} />
          </View>
          <View style={styles.frame}><StepHeader steps={['Dizayn', 'O‘lcham']} current={step} onStep={setStep} /></View>
        </Section>

        <Section title="Icons">
          <View style={styles.wrap}>
            {Object.entries(Icons).map(([name, Icon]) => (
              <View key={name} style={styles.icon}>
                <Icon />
                <T style={mono(12, 1, { color: C.i70 })} numberOfLines={1}>{name}</T>
              </View>
            ))}
          </View>
        </Section>

        <T style={[dispExtra(15, 1, { ls: 0.14 }), { marginTop: 8 }]}>LOOM/</T>
      </ScrollView>
    </View>
  )
}

function Cell({ note, children }: { note: string; children: React.ReactNode }) {
  return (
    <View style={styles.cell}>
      {children}
      <T style={mono(12, 4 / 3, { color: C.i70 })}>{note}</T>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 28, paddingBottom: 48 },
  section: { gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 14 },
  cell: { width: '100%', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  frame: { marginHorizontal: -16 },
  icon: { width: 72, alignItems: 'center', gap: 6 },
})

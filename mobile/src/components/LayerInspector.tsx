import React from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { C, RULE } from '../theme/tokens'
import { disp, mono, monoMed, monoSemi } from '../theme/type'
import { MM_PCT, imageCm } from '../lib/print'
import { TEXT_SIZE_RANGE, useStudio } from '../state/studio'
import { ArtPattern } from './ArtPattern'
import { Slider } from './Slider'
import { Panel, T, Tap } from './ui'
import { useT } from '../i18n'

/**
 * Fine placement lives here rather than on 20px corner handles: a 44px-tall
 * size slider, a rotation slider, and a 1 mm nudge pad with snap-to-centre.
 * Shows the selected layer — artwork or text — on the active face.
 */
export function LayerInspector() {
  const st = useStudio()
  const t = useT()
  const { active, artSelected, textSelected } = st

  if (artSelected && active.art) {
    const art = active.art
    const cm = imageCm(art.sizePct).toFixed(1)
    return (
      <Inspector
        thumb={
          art.uri ? (
            <Image source={{ uri: art.uri }} style={styles.thumb} resizeMode="contain" />
          ) : (
            <ArtPattern
              angle={art.pattern?.angle ?? 45}
              color={art.pattern?.color ?? 'rgba(252,80,68,.55)'}
              gap={art.pattern?.gap ?? 6}
              band={2}
              style={styles.thumb}
            />
          )
        }
        title={art.author ? `${art.name} · ${art.author}` : art.name}
        rows={[
          {
            label: t('ins.size'),
            value: t('ins.cm', { cm }),
            slider: { value: art.sizePct, min: 20, max: 100, onChange: (v) => st.updateArt({ sizePct: v }) },
          },
          {
            label: t('ins.rotation'),
            value: `${art.rotation}°`,
            slider: { value: art.rotation, min: -45, max: 45, onChange: (v) => st.updateArt({ rotation: v }) },
          },
        ]}
        onCenter={st.centerArt}
        onRemove={st.removeArt}
        onNudge={(dx, dy) => st.nudge(dx, dy)}
      />
    )
  }

  if (textSelected && active.text?.content) {
    const tx = active.text
    return (
      <Inspector
        thumb={
          <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
            <T style={{ fontFamily: 'InterTight_800ExtraBold', fontSize: 14, color: tx.color === '#ffffff' ? C.ink : tx.color }}>
              A
            </T>
          </View>
        }
        title={`«${tx.content}»`}
        rows={[
          {
            label: t('ins.fontSize'),
            value: `${Math.round(tx.size)}`,
            slider: {
              value: tx.size,
              min: TEXT_SIZE_RANGE.min,
              max: TEXT_SIZE_RANGE.max,
              step: 2,
              onChange: (v) => st.setText({ size: v }),
            },
          },
          {
            label: t('ins.rotation'),
            value: `${tx.rotation}°`,
            slider: { value: tx.rotation, min: -45, max: 45, onChange: (v) => st.setText({ rotation: v }) },
          },
        ]}
        onCenter={() => st.setText({ offset: { x: 0, y: -30 }, rotation: 0 })}
        onRemove={st.removeText}
        onNudge={(dx, dy) => st.setText({ offset: { x: tx.offset.x + dx, y: tx.offset.y + dy } })}
      />
    )
  }

  return null
}

type RowDef = {
  label: string
  value: string
  slider: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }
}

function Inspector({
  thumb,
  title,
  rows,
  onCenter,
  onRemove,
  onNudge,
}: {
  thumb: React.ReactNode
  title: string
  rows: RowDef[]
  onCenter: () => void
  onRemove: () => void
  onNudge: (dxPct: number, dyPct: number) => void
}) {
  const t = useT()
  return (
    <Panel raised size={2} style={styles.panel}>
      <View style={styles.head}>
        {thumb}
        <T style={[disp(12.5, 1.2), { flex: 1 }]} numberOfLines={1}>
          {title}
        </T>
        <Tap style={styles.smallBtn} onPress={onCenter}>
          <T style={monoSemi(9.5, 1, { ls: 0.1, upper: true, color: C.ink })}>{t('ins.center')}</T>
        </Tap>
        <Tap style={styles.removeBtn} onPress={onRemove} hitSlop={6}>
          <T style={{ fontSize: 15, lineHeight: 20, color: C.deep }}>×</T>
        </Tap>
      </View>

      <View style={styles.body}>
        <View style={{ flex: 1, gap: 9 }}>
          {rows.map((r) => (
            <View key={r.label}>
              <Row label={r.label} value={r.value} />
              <Slider value={r.slider.value} min={r.slider.min} max={r.slider.max} step={r.slider.step} onChange={r.slider.onChange} />
            </View>
          ))}
        </View>

        {/* 1 mm nudge pad — one millimetre on the real 30 × 40 cm platen. */}
        <View style={styles.pad}>
          <View style={styles.padCell} />
          <NudgeBtn arrow="↑" onPress={() => onNudge(0, -MM_PCT.y)} />
          <View style={styles.padCell} />
          <NudgeBtn arrow="←" onPress={() => onNudge(-MM_PCT.x, 0)} />
          <View style={[styles.padCell, styles.padCenter]}>
            <T style={mono(8, 1, { color: C.i38 })}>{t('ins.mm')}</T>
          </View>
          <NudgeBtn arrow="→" onPress={() => onNudge(MM_PCT.x, 0)} />
          <View style={styles.padCell} />
          <NudgeBtn arrow="↓" onPress={() => onNudge(0, MM_PCT.y)} />
          <View style={styles.padCell} />
        </View>
      </View>
    </Panel>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <T style={monoSemi(9.5, 1, { ls: 0.14, upper: true, color: C.i55 })}>{label}</T>
      <T style={monoMed(10.5, 1)}>{value}</T>
    </View>
  )
}

function NudgeBtn({ arrow, onPress }: { arrow: string; onPress: () => void }) {
  return (
    <Tap haptic style={[styles.padCell, styles.padBtn]} onPress={onPress}>
      <T style={{ fontSize: 11, lineHeight: 14, color: C.ink }}>{arrow}</T>
    </Tap>
  )
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 12, marginBottom: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  thumb: { width: 26, height: 26, borderWidth: 1, borderColor: C.ink, backgroundColor: C.paper },
  smallBtn: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.ink,
    backgroundColor: C.paper,
  },
  removeBtn: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: C.ink,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flexDirection: 'row', gap: 11, paddingHorizontal: 11, paddingTop: 10, paddingBottom: 11 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  pad: { width: 84, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  padCell: { width: 26, height: 26 },
  padBtn: {
    borderWidth: 1,
    borderColor: C.ink,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padCenter: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

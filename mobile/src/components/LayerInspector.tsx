import React from 'react'
import { StyleSheet, View } from 'react-native'

import { C, RULE } from '../theme/tokens'
import { disp, mono, monoMed, monoSemi } from '../theme/type'
import { useStudio } from '../state/studio'
import { ArtPattern } from './ArtPattern'
import { Slider } from './Slider'
import { Panel, T, Tap } from './ui'

/**
 * Fine placement lives here rather than on 20px corner handles: a 44px-tall
 * size slider, a rotation slider, and a 1 mm nudge pad with snap-to-centre.
 */
export function LayerInspector() {
  const { active, artSelected, updateArt, removeArt, centerArt, nudge } = useStudio()
  const art = active.art
  if (!art || !artSelected) return null

  const cm = Math.round((28 * art.sizePct) / 100)

  return (
    <Panel raised size={2} style={styles.panel}>
      <View style={styles.head}>
        {art.uri ? (
          <View style={styles.thumb} />
        ) : (
          <ArtPattern
            angle={art.pattern?.angle ?? 45}
            color={art.pattern?.color ?? 'rgba(252,80,68,.55)'}
            gap={art.pattern?.gap ?? 6}
            band={2}
            style={styles.thumb}
          />
        )}
        <T style={[disp(12.5, 1.2), { flex: 1 }]} numberOfLines={1}>
          {art.name}
        </T>
        <Tap style={styles.smallBtn} onPress={centerArt}>
          <T style={monoSemi(9.5, 1, { ls: 0.1, upper: true, color: C.ink })}>По центру</T>
        </Tap>
        <Tap style={styles.removeBtn} onPress={removeArt} hitSlop={6}>
          <T style={{ fontSize: 15, lineHeight: 20, color: C.deep }}>×</T>
        </Tap>
      </View>

      <View style={styles.body}>
        <View style={{ flex: 1, gap: 9 }}>
          <View>
            <Row label="Размер" value={`${cm}×${cm} см`} />
            <Slider
              value={art.sizePct}
              min={20}
              max={100}
              onChange={(v) => updateArt({ sizePct: v })}
            />
          </View>
          <View>
            <Row label="Поворот" value={`${art.rotation}°`} />
            <Slider
              value={art.rotation}
              min={-45}
              max={45}
              onChange={(v) => updateArt({ rotation: v })}
            />
          </View>
        </View>

        {/* 1 mm nudge pad */}
        <View style={styles.pad}>
          <View style={styles.padCell} />
          <NudgeBtn arrow="↑" onPress={() => nudge(0, -2)} />
          <View style={styles.padCell} />
          <NudgeBtn arrow="←" onPress={() => nudge(-2, 0)} />
          <View style={[styles.padCell, styles.padCenter]}>
            <T style={mono(8, 1, { color: C.i38 })}>1 мм</T>
          </View>
          <NudgeBtn arrow="→" onPress={() => nudge(2, 0)} />
          <View style={styles.padCell} />
          <NudgeBtn arrow="↓" onPress={() => nudge(0, 2)} />
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

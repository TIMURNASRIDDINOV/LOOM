import React from 'react'
import { StyleSheet, View } from 'react-native'

import { C, RULE } from '../../theme/tokens'
import { disp, dispSemi, mono } from '../../theme/type'
import { statusLabel, useT } from '../../i18n'
import { Close } from '../icons'
import { T } from '../ui'
import { Tick } from './icons'
import { dayLabel, timeLabel } from './format'
import type { Step } from './steps'

// W31: finished steps are solid ink with a tick, the current one an accent
// square, the rest dashed. The line below a finished step is solid; below the
// current and pending ones it is dashed.

const DASH = 'rgba(19,19,17,0.45)'

function Connector({ solid }: { solid: boolean }) {
  return (
    <View style={styles.connector} pointerEvents="none">
      {solid ? (
        <View style={{ flex: 1, backgroundColor: C.ink }} />
      ) : (
        // A tall column of dashes, clipped to the row's height.
        Array.from({ length: 14 }, (_, i) => <View key={i} style={styles.dash} />)
      )}
    </View>
  )
}

function Marker({ step }: { step: Step }) {
  if (step.key === 'cancelled') {
    return (
      <View style={[styles.marker, { backgroundColor: C.deep }]}>
        <Close size={14} color={C.white} width={3.4} />
      </View>
    )
  }
  if (step.state === 'done') {
    return (
      <View style={[styles.marker, { backgroundColor: C.ink }]}>
        <Tick size={14} color={C.white} width={3.4} />
      </View>
    )
  }
  if (step.state === 'current') {
    return (
      <View style={[styles.marker, { borderWidth: RULE, borderColor: C.ink, backgroundColor: C.coral }]}>
        <View style={{ width: 8, height: 8, backgroundColor: C.ink }} />
      </View>
    )
  }
  return <View style={[styles.marker, { borderWidth: RULE, borderStyle: 'dashed', borderColor: DASH }]} />
}

export function Timeline({ steps }: { steps: Step[] }) {
  const t = useT()
  return (
    <View style={styles.box} accessibilityRole="list">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        const label = statusLabel(s.key, t)
        const when = s.at != null ? `${dayLabel(s.at, t)} · ${timeLabel(s.at)}` : null
        return (
          <View
            key={s.key}
            accessibilityRole="text"
            accessibilityLabel={when ? `${label}, ${when}` : label}
            style={[styles.step, { paddingBottom: last ? 12 : 16 }]}
          >
            {last ? null : <Connector solid={s.state === 'done'} />}
            <Marker step={s} />
            <View style={styles.text}>
              <T style={s.state === 'todo' ? dispSemi(15, 20 / 15, { color: C.i70 }) : disp(15, 20 / 15)}>{label}</T>
              {when ? <T style={mono(12, 20 / 12, { color: C.i70 })}>{when}</T> : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { paddingTop: 14, paddingHorizontal: 14, paddingBottom: 4, borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  step: { flexDirection: 'row', gap: 12 },
  connector: { position: 'absolute', left: 11, top: 24, bottom: 0, width: 2, overflow: 'hidden' },
  dash: { height: 4, marginBottom: 4, backgroundColor: DASH },
  marker: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingTop: 2 },
})

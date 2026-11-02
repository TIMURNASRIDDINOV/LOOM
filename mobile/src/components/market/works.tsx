import React from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Svg, { Defs, Pattern, Rect } from 'react-native-svg'
import type { MyArtwork } from '../../api/types'
import { useT } from '../../i18n'
import { C, RULE, offset } from '../../theme/tokens'
import { body, disp, kicker, label as labelType, mono, monoBold } from '../../theme/type'
import { T } from '../ui'
import { InfoIcon } from './glyphs'

// Pieces the designer screens share: the work rows of the cabinet and the sent
// screen (W41, W44), the upload preview (W42, W43), stat blocks and notes.

/** Transparent-PNG checkerboard (6px squares), drawn under an upload so cut-outs read. */
function Checker() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="loomChecker" width={12} height={12} patternUnits="userSpaceOnUse">
          <Rect width={12} height={12} fill={C.paper} />
          <Rect width={6} height={6} fill={C.white} />
          <Rect x={6} y={6} width={6} height={6} fill={C.white} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#loomChecker)" />
    </Svg>
  )
}

/** A square artwork preview: bordered, the image contained inside. */
export function Thumb({
  uri,
  size,
  checker,
  lifted,
}: {
  uri: string
  size: number
  checker?: boolean
  lifted?: boolean
}) {
  const inner = Math.round(size * 0.82)
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.thumb, { width: size, height: size }, lifted && offset(2)]}
    >
      {checker ? <Checker /> : null}
      <Image source={{ uri }} style={{ width: inner, height: inner }} resizeMode="contain" />
    </View>
  )
}

/** Moderation state (W41, W44): hollow square = under review, solid = published. */
export function StatusChip({ status }: { status: MyArtwork['status'] }) {
  const t = useT()
  const rejected = status === 'rejected'
  const tone = rejected ? C.deep : C.ink
  return (
    <View style={[styles.chip, { borderColor: tone }]}>
      <View
        style={[
          styles.chipDot,
          { borderColor: tone },
          status !== 'pending' && { backgroundColor: tone },
        ]}
      />
      <T style={monoBold(12, 4 / 3, { ls: 0.08, upper: true, color: tone })}>
        {t(status === 'pending' ? 'mod.pending' : status === 'approved' ? 'mod.approved' : 'mod.rejected')}
      </T>
    </View>
  )
}

/** Accent eyebrow on a hairline, the head of a list section ("Ishlar", "Talablar"). */
export function SectionLabel({ children }: { children: string }) {
  return (
    <View style={styles.sectionLabel}>
      <T style={kicker(12)}>{children}</T>
    </View>
  )
}

/** One of the designer's works: thumbnail, title, meta and the moderation chip. */
export function WorkRow({ work, meta }: { work: MyArtwork; meta: string }) {
  return (
    <View style={styles.work}>
      <Thumb uri={work.image_url} size={60} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <T style={disp(15, 1.2)} numberOfLines={1}>
          {work.title}
        </T>
        <T style={mono(12, 4 / 3, { color: C.i70 })}>{meta}</T>
        {work.status === 'rejected' && work.reject_note ? (
          <T style={body(13, 18 / 13, { color: C.i70 })}>{work.reject_note}</T>
        ) : null}
      </View>
      <StatusChip status={work.status} />
    </View>
  )
}

/** A bordered white note with an icon (W41 share note). */
export function Note({ children }: { children: string }) {
  return (
    <View style={styles.note}>
      <View style={{ paddingTop: 1 }}>
        <InfoIcon />
      </View>
      <T style={[body(13, 18 / 13), { flex: 1 }]}>{children}</T>
    </View>
  )
}

/** The cabinet's 2×2 numbers (W41): label over a mono value. */
export function StatGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={styles.grid}>
      {items.map((s) => (
        <View key={s.label} style={styles.gridCell}>
          <T style={labelType(12, { ls: 0.12 })}>{s.label}</T>
          <T style={monoBold(s.value.length > 11 ? 16 : 20, 1.3)} numberOfLines={1}>
            {s.value}
          </T>
        </View>
      ))}
    </View>
  )
}

/** The profile's three numbers in one bordered strip (W39). */
export function StatStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={styles.strip}>
      {items.map((s, i) => (
        <View key={s.label} style={[styles.stripCell, i < items.length - 1 && styles.stripRule]}>
          <T style={labelType(12, { ls: 0.12 })}>{s.label}</T>
          <T style={disp(22, 28 / 22)} numberOfLines={1}>
            {s.value}
          </T>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  thumb: {
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1.5,
    flexShrink: 0,
  },
  chipDot: { width: 8, height: 8, borderWidth: 1.5 },
  sectionLabel: { paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  work: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  note: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderLeftWidth: RULE,
    borderTopWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  gridCell: {
    width: '50%',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRightWidth: RULE,
    borderBottomWidth: RULE,
    borderColor: C.ink,
  },
  strip: { flexDirection: 'row', borderWidth: RULE, borderColor: C.ink, backgroundColor: C.white },
  stripCell: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 10, paddingHorizontal: 12 },
  stripRule: { borderRightWidth: RULE, borderRightColor: C.ink },
})


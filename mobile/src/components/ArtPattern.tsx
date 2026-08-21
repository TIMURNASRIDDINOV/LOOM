import React from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg'

// CSS `repeating-linear-gradient(Ndeg, color 0 Npx, transparent Npx Mpx)` has no
// React Native equivalent, so the marketplace artwork stand-ins are drawn as an
// SVG stripe pattern with the same angle, band width and gap.

export function ArtPattern({
  angle,
  color,
  gap,
  band,
  style,
  background = 'transparent',
}: {
  angle: number
  color: string
  gap: number
  band: number
  style?: StyleProp<ViewStyle>
  background?: string
}) {
  const id = `stripes_${angle}_${gap}_${band}`
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id={id}
            width={gap}
            height={gap}
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${angle})`}
          >
            <Line
              x1={band / 2}
              y1={0}
              x2={band / 2}
              y2={gap}
              stroke={color}
              strokeWidth={band}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={background} />
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/** The 135°/.045 hatch used behind upload dropzones and onboarding art frames. */
export function Hatch({ style, children }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  return (
    <View style={style}>
      <View style={{ position: 'absolute', inset: 0 }} pointerEvents="none">
        <ArtPattern
          angle={135}
          color="rgba(19,19,17,.055)"
          gap={9}
          band={1}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
      {children}
    </View>
  )
}

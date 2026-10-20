import React from 'react'
import Svg, { Path } from 'react-native-svg'
import { C } from '../../theme/tokens'

// Glyphs the shop screens need that `icons.tsx` (LOOM-246) does not have. Same
// 24×24 box, square caps and mitred joins as the rest.
export function ArrowRight({ size = 20, color = C.ink, width = 2.4 }: { size?: number; color?: string; width?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12h14M13 6l6 6-6 6"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </Svg>
  )
}

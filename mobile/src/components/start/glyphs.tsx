import React from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { C } from '../../theme/tokens'

// Glyphs only the start screens use (W05, W07). Same 24×24 box and square caps
// as `components/icons.tsx`, which is shared and stays untouched here.

type P = { size?: number; color?: string; width?: number }

const frame = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const })
const line = (color: string, width: number) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
})

/** Delivery van (W05). */
export function Truck({ size = 16, color = C.ink, width = 2.2 }: P) {
  return (
    <Svg {...frame(size)}>
      <Path d="M3 7h11v9H3z" {...line(color, width)} />
      <Path d="M14 10h4l3 3v3h-7" {...line(color, width)} />
      <Circle cx="7" cy="17.5" r="1.8" {...line(color, width)} />
      <Circle cx="17" cy="17.5" r="1.8" {...line(color, width)} />
    </Svg>
  )
}

/** Clock face on the countdown chip (W07). */
export function Clock({ size = 14, color = C.ink, width = 2.6 }: P) {
  return (
    <Svg {...frame(size)}>
      <Circle cx="12" cy="12" r="8" {...line(color, width)} />
      <Path d="M12 8v4l3 2" {...line(color, width)} />
    </Svg>
  )
}

/** Handset outline for the phone-to-Telegram hand-off picture (W07). */
export function Phone({ size = 30, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...frame(size)}>
      <Rect x="7" y="3" width="10" height="18" {...line(color, width)} />
      <Path d="M11 17.5h2" {...line(color, width)} />
    </Svg>
  )
}

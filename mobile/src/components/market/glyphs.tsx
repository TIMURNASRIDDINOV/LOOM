import React from 'react'
import Svg, { Circle, Path } from 'react-native-svg'
import { C } from '../../theme/tokens'

// Glyphs only the market screens use (W38–W44). `icons.tsx` belongs to the
// shared layer, so these live beside the screens; same 24×24 box and square caps.

type P = { size?: number; color?: string; width?: number }

const frame = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const })
const line = (color: string, width: number) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
})

export function ChevronDown({ size = 18, color = C.ink, width = 2.4 }: P) {
  return (
    <Svg {...frame(size)}>
      <Path d="M6 9l6 6 6-6" {...line(color, width)} />
    </Svg>
  )
}

export function ArrowRight({ size = 18, color = C.ink, width = 2.4 }: P) {
  return (
    <Svg {...frame(size)}>
      <Path d="M5 12h14M13 6l6 6-6 6" {...line(color, width)} />
    </Svg>
  )
}

export function InfoIcon({ size = 18, color = C.ink, width = 2.2 }: P) {
  return (
    <Svg {...frame(size)}>
      <Circle cx="12" cy="12" r="8" {...line(color, width)} />
      <Path d="M12 11v5M12 8h.01" {...line(color, width)} />
    </Svg>
  )
}

export function ShieldIcon({ size = 16, color = C.ink, width = 2.2 }: P) {
  return (
    <Svg {...frame(size)}>
      <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" {...line(color, width)} />
    </Svg>
  )
}

export function ClockIcon({ size = 14, color = C.ink, width = 2.6 }: P) {
  return (
    <Svg {...frame(size)}>
      <Circle cx="12" cy="12" r="8" {...line(color, width)} />
      <Path d="M12 8v4l3 2" {...line(color, width)} />
    </Svg>
  )
}

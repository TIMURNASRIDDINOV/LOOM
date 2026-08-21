import React from 'react'
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg'
import { C } from '../theme/tokens'

// Every path here is transcribed from the prototype's inline SVGs so the icon
// silhouettes match the design exactly. Feather-style: 24×24 box, round caps.

type P = { size?: number; color?: string; width?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
})

const stroke = (color: string, width: number) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export function ChevronLeft({ size = 19, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Polyline points="15 18 9 12 15 6" {...stroke(color, width)} />
    </Svg>
  )
}

export function ChevronRight({ size = 15, color = C.i38, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Polyline points="9 6 15 12 9 18" {...stroke(color, width)} />
    </Svg>
  )
}

export function Close({ size = 22, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Line x1="18" y1="6" x2="6" y2="18" {...stroke(color, width)} />
      <Line x1="6" y1="6" x2="18" y2="18" {...stroke(color, width)} />
    </Svg>
  )
}

export function Search({ size = 17, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Circle cx="11" cy="11" r="7" {...stroke(color, width)} />
      <Line x1="21" y1="21" x2="16.5" y2="16.5" {...stroke(color, width)} />
    </Svg>
  )
}

export function Cart({ size = 17, color = C.ink, width = 1.7 }: P) {
  return (
    <Svg {...base(size)}>
      <Circle cx="9" cy="21" r="1" {...stroke(color, width)} />
      <Circle cx="20" cy="21" r="1" {...stroke(color, width)} />
      <Path
        d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"
        {...stroke(color, width)}
      />
    </Svg>
  )
}

/** Serif "T" — the text tool. */
export function TypeTool({ size = 19, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Polyline points="4 7 4 4 20 4 20 7" {...stroke(color, width)} />
      <Line x1="9" y1="20" x2="15" y2="20" {...stroke(color, width)} />
      <Line x1="12" y1="4" x2="12" y2="20" {...stroke(color, width)} />
    </Svg>
  )
}

/** Framed mountain — the graphic tool. */
export function ImageTool({ size = 19, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Rect x="3" y="3" width="18" height="18" rx="2" {...stroke(color, width)} />
      <Circle cx="8.5" cy="8.5" r="1.5" {...stroke(color, width)} />
      <Path d="M21 15l-5-5L5 21" {...stroke(color, width)} />
    </Svg>
  )
}

/** Folded shirt — the size tool. */
export function SizeTool({ size = 19, color = C.ink, width = 1.7 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M3 9l3-3 4 4 4-4 4 4 3-3" {...stroke(color, width)} />
      <Path d="M21 9v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9" {...stroke(color, width)} />
    </Svg>
  )
}

export function ArrowUpRight({ size = 18, color = C.white, width = 2.2 }: P) {
  return (
    <Svg {...base(size)}>
      <Line x1="7" y1="17" x2="17" y2="7" {...stroke(color, width)} />
      <Polyline points="7 7 17 7 17 17" {...stroke(color, width)} />
    </Svg>
  )
}

export function Upload({ size = 17, color = C.white, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" {...stroke(color, width)} />
      <Polyline points="7 9 12 4 17 9" {...stroke(color, width)} />
      <Line x1="12" y1="4" x2="12" y2="16" {...stroke(color, width)} />
    </Svg>
  )
}

export function Check({ size = 16, color = C.green, width = 3 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M20 6 9 17l-5-5" {...stroke(color, width)} />
    </Svg>
  )
}

export function Crosshair({ size = 15, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Circle cx="12" cy="12" r="3" {...stroke(color, width)} />
      <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...stroke(color, width)} />
    </Svg>
  )
}

/** Telegram paper plane — filled, not stroked. */
export function Telegram({ size = 18, color = C.white }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M21.94 4.27c-.2-.16-.46-.2-.7-.12L2.6 11.4c-.5.2-.5.9.01 1.07l4.7 1.5 1.8 5.6c.16.5.8.62 1.13.22l2.6-3.16 4.9 3.6c.36.27.88.07.97-.38l3.4-15.2c.06-.27-.04-.5-.27-.66zM9.3 14.2l-.5 3.5-1.2-4 9.3-6-7.6 6.5z"
      />
    </Svg>
  )
}

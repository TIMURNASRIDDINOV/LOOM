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

// ─── Tab bar ─────────────────────────────────────────────────────────────────
// The first cut labelled the tabs in 9px mono at 38% opacity with no glyph,
// which read as disabled text rather than navigation. These give each tab a
// silhouette that survives at thumb distance.

export function HomeIcon({ size = 20, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M3 10.5 12 3l9 7.5" {...stroke(color, width)} />
      <Path d="M5.5 9.5V20h13V9.5" {...stroke(color, width)} />
    </Svg>
  )
}

export function GridIcon({ size = 20, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Rect x="3.5" y="3.5" width="7" height="7" {...stroke(color, width)} />
      <Rect x="13.5" y="3.5" width="7" height="7" {...stroke(color, width)} />
      <Rect x="3.5" y="13.5" width="7" height="7" {...stroke(color, width)} />
      <Rect x="13.5" y="13.5" width="7" height="7" {...stroke(color, width)} />
    </Svg>
  )
}

export function BoxIcon({ size = 20, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" {...stroke(color, width)} />
      <Path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" {...stroke(color, width)} />
    </Svg>
  )
}

export function UserIcon({ size = 20, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Circle cx="12" cy="8" r="4" {...stroke(color, width)} />
      <Path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" {...stroke(color, width)} />
    </Svg>
  )
}

/** Overflow affordance for the sign-in sheet's hidden providers. */
export function DotsIcon({ size = 18, color = C.ink }: P) {
  return (
    <Svg {...base(size)}>
      <Circle cx="5" cy="12" r="1.6" fill={color} />
      <Circle cx="12" cy="12" r="1.6" fill={color} />
      <Circle cx="19" cy="12" r="1.6" fill={color} />
    </Svg>
  )
}

/** Google's four-colour G, drawn as filled paths so it reads at 18px. */
export function Google({ size = 18 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.0 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <Path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.0 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </Svg>
  )
}

export function Facebook({ size = 18, color = '#1877F2' }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96H15.83c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
      />
    </Svg>
  )
}

export function Discord({ size = 18, color = '#5865F2' }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M20.32 4.57A19.8 19.8 0 0 0 15.43 3c-.24.42-.5.98-.69 1.43a18.3 18.3 0 0 0-5.48 0C9.07 3.98 8.8 3.42 8.57 3a19.7 19.7 0 0 0-4.9 1.57C.56 9.23-.28 13.77.14 18.25a19.9 19.9 0 0 0 6.05 3.06c.49-.67.92-1.38 1.3-2.13-.72-.27-1.4-.6-2.05-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.13 0c.17.14.33.27.5.4-.65.39-1.34.72-2.06.99.38.75.81 1.46 1.3 2.13a19.9 19.9 0 0 0 6.05-3.06c.5-5.2-.84-9.7-3.54-13.68zM8.02 15.52c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.95 2.41-2.15 2.41zm7.96 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.94 2.41-2.15 2.41z"
      />
    </Svg>
  )
}

export function Mail({ size = 18, color = C.ink, width = 1.8 }: P) {
  return (
    <Svg {...base(size)}>
      <Rect x="2.5" y="5" width="19" height="14" rx="1.5" {...stroke(color, width)} />
      <Path d="m3 6.5 9 6 9-6" {...stroke(color, width)} />
    </Svg>
  )
}

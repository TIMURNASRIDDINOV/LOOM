import React from 'react'
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg'
import { C } from '../theme/tokens'

// Every path here is transcribed from the design's inline SVGs so the icon
// silhouettes match exactly. 24×24 box; v2 draws square caps and mitred joins.

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
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
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

/** The v2 bag — the cart button on every app bar. */
export function Cart({ size = 22, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M4 8h16l-1.5 12h-13z" {...stroke(color, width)} />
      <Path d="M9 8V6a3 3 0 0 1 6 0v2" {...stroke(color, width)} />
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
// Transcribed from the TabBar artboard: 24px, 2px stroke.

export function HomeIcon({ size = 24, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" {...stroke(color, width)} />
    </Svg>
  )
}

export function GridIcon({ size = 24, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Rect x="4" y="4" width="6.5" height="6.5" {...stroke(color, width)} />
      <Rect x="13.5" y="4" width="6.5" height="6.5" {...stroke(color, width)} />
      <Rect x="4" y="13.5" width="6.5" height="6.5" {...stroke(color, width)} />
      <Rect x="13.5" y="13.5" width="6.5" height="6.5" {...stroke(color, width)} />
    </Svg>
  )
}

export function BoxIcon({ size = 24, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M20 8 12 4 4 8v8l8 4 8-4z" {...stroke(color, width)} />
      <Path d="M4 8l8 4 8-4M12 12v8" {...stroke(color, width)} />
    </Svg>
  )
}

export function UserIcon({ size = 24, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Circle cx="12" cy="8.5" r="3.5" {...stroke(color, width)} />
      <Path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" {...stroke(color, width)} />
    </Svg>
  )
}

// ─── v2 actions ──────────────────────────────────────────────────────────────

/** The back arrow in every v2 header (W13, W14, W18…). */
export function ArrowLeft({ size = 20, color = C.ink, width = 2.4 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M19 12H5M11 6l-6 6 6 6" {...stroke(color, width)} />
    </Svg>
  )
}

export function Plus({ size = 16, color = C.ink, width = 2.6 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M12 5v14M5 12h14" {...stroke(color, width)} />
    </Svg>
  )
}

export function Minus({ size = 16, color = C.ink, width = 2.6 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M5 12h14" {...stroke(color, width)} />
    </Svg>
  )
}

export function Trash({ size = 20, color = C.ink, width = 2 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" {...stroke(color, width)} />
    </Svg>
  )
}

/** Map pin — delivery address (W16), account address row (W33). */
export function Pin({ size = 20, color = C.ink, width = 2.4 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z" {...stroke(color, width)} />
      <Circle cx="12" cy="10" r="2.2" {...stroke(color, width)} />
    </Svg>
  )
}

/** Flag — the Report action on every Lab result (W25). */
export function Flag({ size = 18, color = C.inactive, width = 2.2 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M5 21V4M5 4h12l-2 4 2 4H5" {...stroke(color, width)} />
    </Svg>
  )
}
export const Report = Flag

/** Circular arrow — retry and regenerate (W12, W25, W31). */
export function Refresh({ size = 18, color = C.ink, width = 2.4 }: P) {
  return (
    <Svg {...base(size)}>
      <Path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" {...stroke(color, width)} />
    </Svg>
  )
}

/** Struck-through signal — the offline state (W12). */
export function WifiOff({ size = 28, color = C.ink, width = 2.2 }: P) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-3.2-2M2 8.5a15 15 0 0 1 4.5-2.8M22 8.5A15 15 0 0 0 11 5M12 20h.01"
        {...stroke(color, width)}
      />
    </Svg>
  )
}

/** Apple logo, filled — Sign in with Apple (W06). */
export function Apple({ size = 18, color = C.ink }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.2 3.09 3.79 3.04 1.52-.07 2.09-.99 3.93-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.42-.04-.01-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.49 2.6-4.56-1.43-2.09-3.62-2.32-4.39-2.38-2-.16-3.68 1.09-4.61 1.09zm3.38-3.07c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.66.8-3.53 1.82-.78.9-1.46 2.34-1.27 3.71 1.34.1 2.71-.69 3.55-1.7z"
      />
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

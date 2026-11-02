import React from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { C } from '../../theme/tokens'

// Icons the order and account screens need on top of components/icons.tsx
// (T1's file, not edited here). Paths are transcribed from W30–W36; 24×24 box,
// square caps and mitred joins like the rest of the set.

type P = { size?: number; color?: string; width?: number }

function make(paths: string[], extra?: (color: string, width: number) => React.ReactNode) {
  return function Icon({ size = 20, color = C.ink, width = 2 }: P) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {paths.map((d) => (
          <Path key={d} d={d} stroke={color} strokeWidth={width} strokeLinecap="square" strokeLinejoin="miter" />
        ))}
        {extra?.(color, width)}
      </Svg>
    )
  }
}

const line = (c: string, w: number) => ({ stroke: c, strokeWidth: w, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const })

/** Stacked sheets — "My designs". */
export const Layers = make(['M12 4l8 4-8 4-8-4z', 'M4 12l8 4 8-4', 'M4 16l8 4 8-4'])
export const Pencil = make(['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'])
export const Person = make(['M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5'], (c, w) => <Circle cx="12" cy="8.5" r="3.5" {...line(c, w)} />)
export const Globe = make(['M4 12h16', 'M12 4c2.5 2.5 3.5 5 3.5 8s-1 5.5-3.5 8c-2.5-2.5-3.5-5-3.5-8s1-5.5 3.5-8z'], (c, w) => (
  <Circle cx="12" cy="12" r="8" {...line(c, w)} />
))
export const Chat = make(['M4 5h16v11H9l-5 4z'])
export const Doc = make(['M6 3h9l3 3v15H6z', 'M9 11h6', 'M9 15h6'])
export const Shield = make(['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z'])
export const Logout = make(['M10 4H5v16h5', 'M14 8l4 4-4 4', 'M18 12H9'])
export const Camera = make(['M4 8h4l2-3h4l2 3h4v11H4z'], (c, w) => <Circle cx="12" cy="13" r="3.5" {...line(c, w)} />)
export const Lock = make(['M8 11V8a4 4 0 0 1 8 0v3'], (c, w) => <Rect x="5" y="11" width="14" height="9" {...line(c, w)} />)
/** Stroked paper plane — "Telegram'da yozish". */
export const Send = make(['M21 4 3 11l6 2 2 6 3-4 5 4z', 'M9 13l12-9'])
/** Heavy tick on a filled square: a finished timeline step, a status banner. */
export const Tick = make(['M5 12.5 10 17.5 19 7'])
/** The Lab mark: a bold slash in a 20px box. */
export const SlashMark = make(['M8 20 16 4'])

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { Size } from '../theme/tokens'

// The studio holds one artwork layer and one text layer per face. The web
// configurator allows N elements per face; the app deliberately caps it at two
// so placement stays thumb-sized — the design's core call ("fine placement
// moves off the 20px corner handles into the layer inspector").

export type Face = 'front' | 'back'
export type Tool = 'text' | 'image' | 'color' | 'size' | null
export type Surface = '2d' | '3d'

export type ArtLayer = {
  id: string
  name: string
  /** Local file URI (user upload) or null for a marketplace pattern. */
  uri: string | null
  /** R2 key once uploaded — attached to the order so print can fetch it. */
  uploadKey: string | null
  /** Designer markup added to the garment price, in sum. */
  price: number
  /** Author handle for marketplace artwork. */
  author?: string
  /** Stripe angle for marketplace placeholder art with no bitmap. */
  pattern?: { angle: number; color: string; gap: number }
  sizePct: number
  rotation: number
  offset: { x: number; y: number }
}

export type TextLayer = {
  id: string
  content: string
  font: string
  size: number
  color: string
  rotation: number
  offset: { x: number; y: number }
}

export type FaceState = { art: ArtLayer | null; text: TextLayer | null }

export type StudioState = {
  productId: number | null
  productName: string
  basePrice: number
  color: string
  colorName: string
  size: Size
  front: FaceState
  back: FaceState
}

const emptyFace = (): FaceState => ({ art: null, text: null })

const initial: StudioState = {
  productId: null,
  productName: 'Классическая футболка',
  basePrice: 150000,
  color: '#FFFFFF',
  colorName: 'Белый',
  size: 'L',
  front: emptyFace(),
  back: emptyFace(),
}

type StudioCtx = {
  s: StudioState
  face: Face
  surface: Surface
  tool: Tool
  artSelected: boolean
  /** Layers on the active face — what the stage and inspector operate on. */
  active: FaceState
  layerCount: number
  total: number

  setFace: (f: Face) => void
  setSurface: (v: Surface) => void
  pickTool: (t: Exclude<Tool, null>) => void
  closeTool: () => void
  selectArt: (v: boolean) => void

  loadProduct: (p: { id: number; name: string; price: number }) => void
  setColor: (hex: string, name: string) => void
  setSize: (z: Size) => void

  setArt: (a: Omit<ArtLayer, 'sizePct' | 'rotation' | 'offset' | 'id'> & Partial<ArtLayer>) => void
  updateArt: (patch: Partial<ArtLayer>) => void
  removeArt: () => void
  centerArt: () => void
  nudge: (dx: number, dy: number) => void

  setText: (patch: Partial<TextLayer>) => void
  reset: () => void
}

const Ctx = createContext<StudioCtx | null>(null)

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<StudioState>(initial)
  const [face, setFace] = useState<Face>('front')
  const [surface, setSurface] = useState<Surface>('2d')
  const [tool, setTool] = useState<Tool>(null)
  const [artSelected, setArtSelected] = useState(false)

  const active = s[face]

  const patchFace = useCallback(
    (fn: (f: FaceState) => FaceState) => {
      setS((prev) => ({ ...prev, [face]: fn(prev[face]) }))
    },
    [face],
  )

  const pickTool = useCallback((t: Exclude<Tool, null>) => {
    // Tapping the open tool closes it — the garment keeps the stage.
    setTool((prev) => (prev === t ? null : t))
    setArtSelected(false)
  }, [])

  const setArt: StudioCtx['setArt'] = useCallback(
    (a) => {
      patchFace((f) => ({
        ...f,
        art: {
          id: a.id ?? `art_${Date.now()}`,
          sizePct: a.sizePct ?? 58,
          rotation: a.rotation ?? 0,
          offset: a.offset ?? { x: 0, y: 0 },
          ...a,
        } as ArtLayer,
      }))
      setArtSelected(true)
      setTool(null)
    },
    [patchFace],
  )

  const updateArt = useCallback(
    (patch: Partial<ArtLayer>) => {
      patchFace((f) => (f.art ? { ...f, art: { ...f.art, ...patch } } : f))
    },
    [patchFace],
  )

  const setText = useCallback(
    (patch: Partial<TextLayer>) => {
      patchFace((f) => ({
        ...f,
        text: {
          id: f.text?.id ?? `txt_${Date.now()}`,
          content: '',
          font: 'Inter Tight',
          size: 15,
          color: '#131311',
          rotation: 0,
          offset: { x: 0, y: -14 },
          ...f.text,
          ...patch,
        },
      }))
    },
    [patchFace],
  )

  const layerCount = (active.art ? 1 : 0) + (active.text?.content ? 1 : 0)

  // Designer markup is charged once per artwork, on whichever faces carry it.
  const total = useMemo(() => {
    const markup = (s.front.art?.price ?? 0) + (s.back.art?.price ?? 0)
    return s.basePrice + markup
  }, [s])

  const value: StudioCtx = {
    s,
    face,
    surface,
    tool,
    artSelected: !!(active.art && artSelected),
    active,
    layerCount,
    total,

    setFace,
    setSurface,
    pickTool,
    closeTool: () => setTool(null),
    selectArt: setArtSelected,

    loadProduct: (p) =>
      setS((prev) => ({ ...prev, productId: p.id, productName: p.name, basePrice: p.price })),
    setColor: (hex, name) => setS((prev) => ({ ...prev, color: hex, colorName: name })),
    setSize: (z) => setS((prev) => ({ ...prev, size: z })),

    setArt,
    updateArt,
    removeArt: () => {
      patchFace((f) => ({ ...f, art: null }))
      setArtSelected(false)
    },
    centerArt: () => updateArt({ offset: { x: 0, y: 0 }, rotation: 0 }),
    nudge: (dx, dy) =>
      patchFace((f) =>
        f.art
          ? {
              ...f,
              art: {
                ...f.art,
                offset: { x: f.art.offset.x + dx, y: f.art.offset.y + dy },
              },
            }
          : f,
      ),

    setText,
    reset: () => {
      setS((prev) => ({ ...initial, productId: prev.productId, productName: prev.productName, basePrice: prev.basePrice }))
      setFace('front')
      setTool(null)
      setArtSelected(false)
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStudio(): StudioCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStudio must be used inside <StudioProvider>')
  return v
}

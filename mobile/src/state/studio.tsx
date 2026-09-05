import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Size } from '../theme/tokens'

// The studio holds one artwork layer and one text layer per face. The web
// configurator allows N elements per face; the app deliberately caps it at two
// so placement stays thumb-sized — the design's core call ("fine placement
// moves off the 20px corner handles into the layer inspector").
//
// Coordinates: every layer sits at a percent offset from the CENTRE of the
// print rect (30 × 40 cm platen), so `offset.x = 10` means 3 cm right of centre
// on every surface — the flat stage, the 3D garment and the print master.
// Sizes: `sizePct` is the web's scalePct; text `size` is px in the web's
// reference rect (see lib/print.ts). Rotation is degrees here and converted to
// radians in design_json.

export type Face = 'front' | 'back'
export type Tool = 'text' | 'image' | 'color' | 'size' | null
export type Surface = '2d' | '3d'

export type ArtLayer = {
  id: string
  name: string
  /** Local file URI (user upload) or remote URL (marketplace artwork). */
  uri: string | null
  /** MIME of a local upload — needed to inline it for the 3D page. */
  mime?: string
  /** R2 key the print shop fetches: our upload, or the marketplace file. */
  uploadKey: string | null
  /** Marketplace artwork id — attributes the sale to its designer. */
  artworkId?: number
  /** Designer markup added to the garment price, in sum. */
  price: number
  /** Author handle for marketplace artwork. */
  author?: string
  /** Stripe angle for placeholder art with no bitmap. */
  pattern?: { angle: number; color: string; gap: number }
  sizePct: number
  rotation: number
  offset: { x: number; y: number }
}

export type TextLayer = {
  id: string
  content: string
  font: string
  /** px in REF_RECT space, like the web's text size. */
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

export const DEFAULT_TEXT_SIZE = 150
export const TEXT_SIZE_RANGE = { min: 60, max: 320 }

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

// The home screen's "Продолжить" card promises the last design survives a
// restart, so the state is mirrored to storage (debounced — sliders fire fast).
const STORE_KEY = 'loom_studio_v2'

type StudioCtx = {
  s: StudioState
  face: Face
  surface: Surface
  tool: Tool
  artSelected: boolean
  textSelected: boolean
  /** Layers on the active face — what the stage and inspector operate on. */
  active: FaceState
  layerCount: number
  total: number
  /** True once the persisted design has been read back. */
  hydrated: boolean

  setFace: (f: Face) => void
  setSurface: (v: Surface) => void
  pickTool: (t: Exclude<Tool, null>) => void
  closeTool: () => void
  selectArt: (v: boolean) => void
  selectText: (v: boolean) => void

  loadProduct: (p: { id: number; name: string; price: number }) => void
  setColor: (hex: string, name: string) => void
  setSize: (z: Size) => void

  setArt: (a: Omit<ArtLayer, 'sizePct' | 'rotation' | 'offset' | 'id'> & Partial<ArtLayer>) => void
  updateArt: (patch: Partial<ArtLayer>) => void
  /** Patch the artwork on a specific face, whichever face is active. */
  updateArtOn: (face: Face, patch: Partial<ArtLayer>) => void
  removeArt: () => void
  centerArt: () => void
  nudge: (dx: number, dy: number) => void

  setText: (patch: Partial<TextLayer>) => void
  removeText: () => void
  reset: () => void
}

const Ctx = createContext<StudioCtx | null>(null)

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<StudioState>(initial)
  const [face, setFace] = useState<Face>('front')
  const [surface, setSurface] = useState<Surface>('2d')
  const [tool, setTool] = useState<Tool>(null)
  const [artSelected, setArtSelected] = useState(false)
  const [textSelected, setTextSelected] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return
        const saved = JSON.parse(raw) as Partial<StudioState>
        // Only trust the shape we wrote; anything odd falls back to defaults.
        if (saved && typeof saved === 'object' && saved.front && saved.back) {
          setS({ ...initial, ...saved })
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORE_KEY, JSON.stringify(s)).catch(() => {})
    }, 400)
  }, [s, hydrated])

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
    setTextSelected(false)
  }, [])

  const setArt: StudioCtx['setArt'] = useCallback(
    (a) => {
      patchFace((f) => ({
        ...f,
        art: {
          id: a.id ?? `art_${Date.now()}`,
          sizePct: a.sizePct ?? f.art?.sizePct ?? 58,
          rotation: a.rotation ?? f.art?.rotation ?? 0,
          offset: a.offset ?? f.art?.offset ?? { x: 0, y: 0 },
          ...a,
        } as ArtLayer,
      }))
      setArtSelected(true)
      setTextSelected(false)
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
          size: DEFAULT_TEXT_SIZE,
          color: '#131311',
          rotation: 0,
          // Sits in the upper third of the print area, above where artwork lands.
          offset: { x: 0, y: -30 },
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
    textSelected: !!(active.text?.content && textSelected),
    active,
    layerCount,
    total,
    hydrated,

    setFace: (f) => {
      setFace(f)
      setArtSelected(false)
      setTextSelected(false)
    },
    setSurface,
    pickTool,
    closeTool: () => setTool(null),
    selectArt: (v) => {
      setArtSelected(v)
      if (v) setTextSelected(false)
    },
    selectText: (v) => {
      setTextSelected(v)
      if (v) setArtSelected(false)
    },

    loadProduct: (p) =>
      setS((prev) =>
        prev.productId === p.id
          ? prev
          : { ...prev, productId: p.id, productName: p.name, basePrice: p.price },
      ),
    setColor: (hex, name) => setS((prev) => ({ ...prev, color: hex, colorName: name })),
    setSize: (z) => setS((prev) => ({ ...prev, size: z })),

    setArt,
    updateArt,
    updateArtOn: (f, patch) =>
      setS((prev) => (prev[f].art ? { ...prev, [f]: { ...prev[f], art: { ...prev[f].art!, ...patch } } } : prev)),
    removeArt: () => {
      patchFace((f) => ({ ...f, art: null }))
      setArtSelected(false)
    },
    centerArt: () => updateArt({ offset: { x: 0, y: 0 }, rotation: 0 }),
    nudge: (dx, dy) =>
      patchFace((f) =>
        f.art
          ? { ...f, art: { ...f.art, offset: { x: f.art.offset.x + dx, y: f.art.offset.y + dy } } }
          : f,
      ),

    setText,
    removeText: () => {
      patchFace((f) => ({ ...f, text: null }))
      setTextSelected(false)
    },
    reset: () => {
      setS((prev) => ({
        ...initial,
        productId: prev.productId,
        productName: prev.productName,
        basePrice: prev.basePrice,
      }))
      setFace('front')
      setTool(null)
      setArtSelected(false)
      setTextSelected(false)
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStudio(): StudioCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStudio must be used inside <StudioProvider>')
  return v
}

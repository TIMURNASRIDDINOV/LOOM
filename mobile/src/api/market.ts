// ─── MOCK DATA ───────────────────────────────────────────────────────────────
// The designer marketplace and the publish flow are new in this design — the
// backend has no artwork, markup or moderation tables yet, so these four pieces
// are the prototype's fixtures. Everything else in the app talks to the live
// API. Replacing this file with real endpoints is the one wiring task left.

export type Artwork = {
  id: string
  name: string
  author: string
  price: number
  /** Stripe pattern standing in for the artwork bitmap. */
  pattern: { angle: number; color: string; gap: number; band: number }
}

export const ARTWORKS: Artwork[] = [
  {
    id: 'art_chorsu',
    name: 'Chorsu Nights',
    author: '@ozod',
    price: 25000,
    pattern: { angle: 45, color: 'rgba(252,80,68,.35)', gap: 8, band: 2 },
  },
  {
    id: 'art_suzani',
    name: 'Suzani Grid',
    author: '@dilnoza',
    price: 30000,
    pattern: { angle: 90, color: 'rgba(19,19,17,.28)', gap: 11, band: 3 },
  },
  {
    id: 'art_metro',
    name: 'Tashkent Metro',
    author: '@sardor.uz',
    price: 20000,
    pattern: { angle: 0, color: 'rgba(19,19,17,.22)', gap: 7, band: 1 },
  },
  {
    id: 'art_qatta',
    name: 'Qatta Type',
    author: '@lola',
    price: 35000,
    pattern: { angle: 135, color: 'rgba(252,80,68,.28)', gap: 12, band: 4 },
  },
]

export const ONBOARDING = [
  {
    kicker: 'Шаг 01',
    title: 'Носи то, что ты придумал.',
    body: 'Текст, своя графика, цвет — всё в одном экране. Без Photoshop и без дизайнера.',
    art: 'заглушка / кадр студии',
  },
  {
    kicker: 'Шаг 02',
    title: 'Смотри до печати.',
    body: 'Плоская развёртка для точной раскладки и 3D — чтобы понять, как это сядет.',
    art: 'заглушка / 2D ↔ 3D',
  },
  {
    kicker: 'Шаг 03',
    title: 'Заказ в два тапа.',
    body: 'Вход через Telegram, пин на карте, доставка по Узбекистану за 2–4 дня.',
    art: 'заглушка / карта доставки',
  },
]

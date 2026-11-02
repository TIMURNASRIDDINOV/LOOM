import type { Group } from '../strings'

// Shop group (LOOM-248): home, catalog, product, cart and checkout. Add every
// key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {
  // Home — the Lab hero (only mounted while the Lab flag is on) and the pitch.
  'home.lab.kicker': 'LOOM/ Lab',
  'home.lab.t1': 'Опишите словами.',
  'home.lab.t2': 'Наденьте на себя.',
  'home.lab.tag': 'prompt',
  'home.lab.ph': 'карта Ташкента тонкими линиями',
  'home.lab.go': 'Придумать с LOOM Lab',
  'home.lab.ex1': 'узор граната в стиле сюзане',
  'home.lab.ex2': 'горы Чимган на закате, минимализм',
  'home.pitchKicker': 'Дизайнерам',

  // Catalog
  'catalog.loadFailed': 'Не удалось загрузить каталог',
  'catalog.marketRow': 'Работы дизайнеров',

  // Product
  'product.cm': 'см',
  'product.design': 'Добавить дизайн →',

  // Cart
  'cart.remove': 'Удалить',
  'cart.dropped': '«{name}» больше не продаётся и убрана из корзины.',
  'cart.errUpdate': 'Не удалось обновить корзину. Попробуйте ещё раз.',

  // Checkout
  'co.priceChanged': 'Цена изменилась. Удалите эту вещь из корзины и добавьте её заново, чтобы увидеть новую цену.',
  'co.errSync': 'Не удалось отправить корзину. Проверьте интернет и попробуйте ещё раз.',
}

export const shop: Group<typeof ru> = {
  ru,
  uz: {
    'home.lab.kicker': 'LOOM/ Lab',
    'home.lab.t1': 'So‘z bilan tasvirlang.',
    'home.lab.t2': 'Kiyib yuring.',
    'home.lab.tag': 'prompt',
    'home.lab.ph': 'ingichka chiziqlarda Toshkent xaritasi',
    'home.lab.go': 'LOOM Lab bilan o‘ylab topish',
    'home.lab.ex1': 'so‘zana uslubidagi anor naqshi',
    'home.lab.ex2': 'quyosh botishida Chimyon tog‘lari, minimalizm',
    'home.pitchKicker': 'Dizaynerlarga',

    'catalog.loadFailed': 'Katalogni yuklab bo‘lmadi',
    'catalog.marketRow': 'Dizaynerlar ishlari',

    'product.cm': 'sm',
    'product.design': 'Dizayn qo‘shish →',

    'cart.remove': 'O‘chirish',
    'cart.dropped': '«{name}» endi sotilmaydi va savatchadan olib tashlandi.',
    'cart.errUpdate': 'Savatchani yangilab bo‘lmadi. Qayta urinib ko‘ring.',

    'co.priceChanged': 'Narx o‘zgardi. Yangi narxni ko‘rish uchun mahsulotni savatchadan o‘chirib, qayta qo‘shing.',
    'co.errSync': 'Savatchani yuborib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.',
  },
  en: {
    'home.lab.kicker': 'LOOM/ Lab',
    'home.lab.t1': 'Describe it in words.',
    'home.lab.t2': 'Wear it.',
    'home.lab.tag': 'prompt',
    'home.lab.ph': 'a map of Tashkent in thin lines',
    'home.lab.go': 'Create with LOOM Lab',
    'home.lab.ex1': 'a pomegranate pattern in suzani style',
    'home.lab.ex2': 'Chimgan mountains at sunset, minimalist',
    'home.pitchKicker': 'For designers',

    'catalog.loadFailed': 'Couldn’t load the catalog',
    'catalog.marketRow': 'Designers’ works',

    'product.cm': 'cm',
    'product.design': 'Add a design →',

    'cart.remove': 'Remove',
    'cart.dropped': '“{name}” is no longer sold and was removed from your cart.',
    'cart.errUpdate': 'Couldn’t update the cart. Try again.',

    'co.priceChanged': 'The price changed. Remove this item from your cart and add it again to see the new price.',
    'co.errSync': 'Couldn’t send your cart. Check your connection and try again.',
  },
}

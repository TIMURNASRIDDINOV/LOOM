import type { Group } from '../strings'

// Market group (LOOM-252): market, designer profile and the publish flow. Add
// every key to ru, uz and en — a key in one language only fails `tsc`. The
// older mk.*, dz.*, pub.* and mod.* keys still live in ../strings.ts.
const ru = {
  'mk.openCall': 'Открытый набор',
  'mk.slotYours': 'Здесь будет ваш принт',

  'pub.how1': 'Придумайте ник — под ним покупатели увидят ваши работы.',
  'pub.how2': 'Загрузите файл и задайте свою наценку.',
  'pub.how3': 'После проверки работа появится в маркете, а продажи — здесь.',
  'pub.step': 'Шаг {n}',
  'pub.next': 'Далее',
  'pub.catPick': 'Выберите',
  'pub.markupBuyer': 'Покупатель платит цену вещи + {markup} сум.',
  'pub.designerChip': 'дизайнер · {handle}',
}

export const market: Group<typeof ru> = {
  ru,
  uz: {
    'mk.openCall': 'Ochiq chaqiruv',
    'mk.slotYours': 'Sizning printingiz shu yerda',

    'pub.how1': 'Nik o‘ylab toping — ishlaringizni xaridorlar shu nom ostida ko‘radi.',
    'pub.how2': 'Faylni yuklang va o‘z ustamangizni belgilang.',
    'pub.how3': 'Tekshiruvdan so‘ng ish marketda paydo bo‘ladi, sotuvlar esa — shu yerda.',
    'pub.step': '{n}-qadam',
    'pub.next': 'Keyingi',
    'pub.catPick': 'Tanlang',
    'pub.markupBuyer': 'Xaridor kiyim narxi + {markup} so‘m to‘laydi.',
    'pub.designerChip': 'dizayner · {handle}',
  },
  en: {
    'mk.openCall': 'Open call',
    'mk.slotYours': 'Your print goes here',

    'pub.how1': 'Pick a handle — buyers will see your works under it.',
    'pub.how2': 'Upload the file and set your markup.',
    'pub.how3': 'After review the work appears in the market; your sales show up here.',
    'pub.step': 'Step {n}',
    'pub.next': 'Next',
    'pub.catPick': 'Choose',
    'pub.markupBuyer': 'The buyer pays the garment price + {markup} UZS.',
    'pub.designerChip': 'designer · {handle}',
  },
}

/* ================================================================
   LOOM — Lightweight i18n (UZ / RU / EN)
   - data-i18n="key"            → element.textContent
   - data-i18n-html="key"       → element.innerHTML (for markup like <strong>)
   - data-i18n-attr="attr:key;…" → element attribute(s), e.g. "placeholder:order.namePh"
   Language persists in localStorage. Default: Russian.
   Public API: window.LOOM_I18N = { getLang, setLang, t, apply, formatPrice, LANGS }
   Fires window event "loom:langchange" with detail.lang so JS-rendered
   content (product cards, orders, toasts) can re-render.
================================================================ */
'use strict';
(function () {
  const LANGS = ['uz', 'ru', 'en'];
  const DEFAULT = 'ru';
  const STORE_KEY = 'loom_lang';

  const LANG_LABELS = { uz: "O‘zbekcha", ru: 'Русский', en: 'English' };
  const LANG_SHORT  = { uz: 'UZ', ru: 'RU', en: 'EN' };

  // ── Dictionary ────────────────────────────────────────────────
  const DICT = {
    // ===== Navigation (shared) =====
    'nav.home':       { uz: 'Bosh sahifa', ru: 'Главная',       en: 'Home' },
    'nav.catalog':    { uz: 'Katalog',     ru: 'Каталог',       en: 'Catalog' },
    'nav.configure':  { uz: 'Konstruktor', ru: 'Кастомизация',  en: 'Customize' },
    'nav.about':      { uz: 'Biz haqimizda', ru: 'О нас',        en: 'About' },
    'nav.start':      { uz: 'Dizayn yaratish', ru: 'Создать дизайн', en: 'Start designing' },
    'nav.login':      { uz: 'Kirish',      ru: 'Войти',          en: 'Sign in' },
    'nav.account':    { uz: 'Shaxsiy kabinet', ru: 'Личный кабинет', en: 'My account' },
    'nav.settings':   { uz: 'Sozlamalar',  ru: 'Настройки',      en: 'Settings' },
    'nav.logout':     { uz: 'Chiqish',     ru: 'Выйти',          en: 'Sign out' },
    'nav.cart':       { uz: 'Savatcha',    ru: 'Корзина',        en: 'Cart' },
    'nav.backToStore':{ uz: '← Do‘konga qaytish', ru: '← Вернуться на сайт', en: '← Back to store' },
    'nav.language':   { uz: 'Til',         ru: 'Язык',           en: 'Language' },
    'nav.theme':      { uz: 'Mavzu',       ru: 'Тема',           en: 'Theme' },

    // ===== Home — hero =====
    /* the accent "/" is markup now (see index.html), not part of the string */
    'hero.t1':       { uz: 'Tasavvurni',          ru: 'Носи',            en: 'Wear' },
    'hero.t2':       { uz: 'kiyimga',             ru: 'то, что ты',       en: 'what you' },
    'hero.t3':       { uz: 'aylantiring.',        ru: 'придумал.',        en: 'imagine.' },
    'hero.subtitle': { uz: 'O‘z kiyimingizni o‘zingiz yarating. Uni 3D’da ko‘ring. O‘zbekiston bo‘ylab yetkazib beramiz.', ru: 'Создайте собственную одежду. Посмотрите её в 3D. Доставим по всему Узбекистану.', en: 'Design your own clothes. See them in 3D. Order to your door anywhere in Uzbekistan.' },
    'hero.start':    { uz: 'Dizayn yaratish', ru: 'Создать дизайн',  en: 'Start designing' },
    'hero.catalog':  { uz: 'Katalogni ko‘rish', ru: 'Смотреть каталог', en: 'View catalog' },

    // ===== Home — stats =====
    'stats.products': { uz: 'Mahsulot',   ru: 'Товаров',   en: 'Products' },
    'stats.colors':   { uz: 'Rang',       ru: 'Цветов',    en: 'Colors' },
    'stats.preview':  { uz: 'Ko‘rinish',  ru: 'Просмотр',  en: 'Preview' },
    'stats.shipping': { uz: 'Yetkazish',  ru: 'Доставка',  en: 'Shipping' },

    // ===== Home — spotlight =====
    'spot.eyebrow':  { uz: 'Eng ommabop',  ru: 'Хит продаж',    en: 'Best seller' },
    'spot.t1':       { uz: 'Klassik',      ru: 'Классическая',   en: 'Classic' },
    'spot.t2':       { uz: 'futbolka.',    ru: 'футболка.',      en: 'T-shirt.' },
    'spot.d1':       { uz: '<strong>100% paxta</strong> · Uniseks bichim', ru: '<strong>100% хлопок</strong> · Унисекс крой', en: '<strong>100% cotton</strong> · Unisex cut' },
    'spot.d2':       { uz: '<strong>5 ta asosiy rang</strong> · 89 000 so‘mdan', ru: '<strong>5 базовых цветов</strong> · от 89 000 сум', en: '<strong>5 base colors</strong> · From 89,000 UZS' },
    'spot.customize':{ uz: 'Buni sozlash', ru: 'Настроить эту', en: 'Customize this' },

    // ===== Home — products grid (static cards) =====
    'prod.sectionLabel': { uz: 'Mahsulotlar', ru: 'Товары',     en: 'Products' },
    'prod.viewAll':      { uz: 'Hammasini ko‘rish →', ru: 'Смотреть все →', en: 'View all →' },
    'prod.t1.name':  { uz: 'Klassik futbolka', ru: 'Классическая футболка', en: 'Classic T-shirt' },
    'prod.t1.desc':  { uz: '100% premium paxta, uniseks bichim, erkin fason. Dizayningiz uchun mukammal asos.', ru: '100% премиальный хлопок, унисекс крой, свободный фасон. Идеальный холст для вашего дизайна.', en: '100% premium cotton, unisex cut, oversized fit. The perfect canvas for your design.' },
    'prod.t2.name':  { uz: 'Qalin xudi',  ru: 'Тёплое худи',    en: 'Heavyweight Hoodie' },
    'prod.t2.desc':  { uz: 'Ichi yumshoq premium mato, ikki qatlamli kapyushon, barcha fasllar uchun erkin siluet.', ru: 'Премиальная ткань с начёсом, двухслойный капюшон, свободный силуэт на все сезоны.', en: 'Fleece-lined premium fabric, double-layered hood, relaxed silhouette for all seasons.' },
    'prod.t3.name':  { uz: 'Polo futbolka', ru: 'Поло',         en: 'Polo Shirt' },
    'prod.t3.desc':  { uz: 'Piké paxta aralashmasi, tikilgan yoqa, toza chiziqlar. Bemalol smart-casual.', ru: 'Хлопок пике, структурированный воротник, чистые линии. Smart casual без усилий.', en: 'Piqué cotton blend, structured collar, clean tailored lines. Smart casual, effortlessly.' },

    // ===== Home — CTA =====
    'cta.t1':       { uz: 'Sizning dizayningiz.', ru: 'Твой дизайн.',  en: 'Your design.' },
    'cta.t2':       { uz: 'Sizning qoidalaringiz.', ru: 'Твои правила.', en: 'Your rules.' },
    'cta.subtitle': { uz: 'Bo‘sh asosdan boshlang. Matn qo‘shing, rasm yuklang, ranglarni tanlang.', ru: 'Начните с чистого холста. Добавьте текст, загрузите изображение, выберите цвета.', en: 'Start with a blank canvas. Add text, upload artwork, pick your colors.' },
    'cta.open':     { uz: 'Konstruktorni ochish →', ru: 'Открыть конфигуратор →', en: 'Open configurator →' },

    // ===== Footer =====
    'footer.contact':  { uz: 'Aloqa',  ru: 'Контакты',  en: 'Contact' },
    'footer.location': { uz: 'Toshkent, O‘zbekiston', ru: 'Ташкент, Узбекистан', en: 'Tashkent, Uzbekistan' },
    'footer.navTitle':    { uz: 'Sahifalar', ru: 'Навигация', en: 'Navigate' },
    'footer.socialTitle': { uz: 'Aloqa',     ru: 'Связь',     en: 'Connect' },

    // ===== Marquee (redesign) =====
    'marquee.a': { uz: 'Tasavvuringizdagini kiying', ru: 'Носи то, что ты придумал', en: 'Wear what you imagine' },
    'marquee.b': { uz: 'Kiyish uchun yaratilgan',    ru: 'Создано, чтобы носить',    en: 'Made to be worn' },
    'marquee.c': { uz: 'O‘z dizayningiz. 3D’da',     ru: 'Твой дизайн. В 3D',        en: 'Your design. In 3D' },

    // ===== Catalog =====
    'catalog.heroTitle':    { uz: 'Kolleksiyamizni kashf eting', ru: 'Исследуйте нашу коллекцию', en: 'Explore our collection' },
    'catalog.heroSubtitle': { uz: 'Interaktiv 3D ko‘rinish', ru: 'Интерактивный 3D просмотр модели', en: 'Interactive 3D model preview' },
    'catalog.customize':    { uz: 'Dizaynni sozlash', ru: 'Настроить дизайн', en: 'Customize design' },
    'catalog.loadError':    { uz: 'Katalogni yuklab bo‘lmadi.', ru: 'Не удалось загрузить каталог.', en: 'Failed to load the catalog.' },
    'catalog.retry':        { uz: 'Qayta urinish', ru: 'Повторить', en: 'Retry' },
    'catalog.empty':        { uz: 'Katalog bo‘sh.', ru: 'Каталог пуст.', en: 'The catalog is empty.' },
    'catalog.soon':         { uz: 'Tez orada', ru: 'Скоро', en: 'Coming soon' },
    'catalog.tabAll':       { uz: 'Hammasi', ru: 'Все', en: 'All' },
    'catalog.tabCustom':    { uz: 'Moslashtirish', ru: 'Кастомизация', en: 'Customizable' },
    'catalog.tabReady':     { uz: 'Tayyor dizaynlar', ru: 'Готовые дизайны', en: 'Ready designs' },
    'catalog.readyBadge':   { uz: 'Tayyor dizayn', ru: 'Готовый дизайн', en: 'Ready design' },
    'catalog.customNote':   { uz: 'Konfiguratorda o‘z dizayningizni yarating', ru: 'Создайте свой дизайн в 3D-конфигураторе', en: 'Create your own design in the 3D configurator' },
    'catalog.readyNote':    { uz: 'Sotib olishga tayyor — o‘lchamni tanlang', ru: 'Готовы к покупке — просто выберите размер', en: 'Ready to buy — just pick a size' },

    // ===== Configurator — panel =====
    'cfg.panelProduct': { uz: 'O‘z dizayningizni yarating', ru: 'Создайте свой дизайн', en: 'Create your design' },
    'cfg.currency':     { uz: 'so‘m', ru: 'сум', en: 'UZS' },
    'cfg.tabColor':     { uz: 'Rang',   ru: 'Цвет',   en: 'Color' },
    'cfg.tabDesign':    { uz: 'Dizayn', ru: 'Дизайн', en: 'Design' },
    'cfg.tabSummary':   { uz: 'Yakun',  ru: 'Итог',   en: 'Summary' },
    'cfg.shirtColor':   { uz: 'Futbolka rangi', ru: 'Цвет футболки', en: 'Shirt color' },
    'cfg.size':         { uz: 'O‘lcham', ru: 'Размер', en: 'Size' },
    'cfg.dragHint':     { uz: 'Dizaynni suring — ko‘chirish · burchaklar — o‘lcham · doira — burish · bo‘sh joy — futbolkani aylantirish', ru: 'Тяните дизайн — двигать · углы — размер · кружок — поворот · пустое поле — вращать футболку', en: 'Drag the design to move · corners resize · circle rotates · empty area spins the shirt' },
    'cfg.layerText':    { uz: 'Matn',     ru: 'Текст',    en: 'Text' },
    'cfg.layerLogo':    { uz: 'Logotip',  ru: 'Логотип',  en: 'Logo' },
    'cfg.addText':      { uz: 'Matn',     ru: 'Текст',    en: 'Text' },
    'cfg.addLogo':      { uz: 'Logotip',  ru: 'Логотип',  en: 'Logo' },
    'cfg.layerEmpty':   { uz: 'Bu tomonga matn yoki logotip qo‘shing', ru: 'Добавьте текст или логотип на эту сторону', en: 'Add text or a logo to this side' },
    'cfg.newTextDefault': { uz: 'Matningiz', ru: 'Ваш текст', en: 'Your text' },
    'cfg.uploadReplace':{ uz: 'Rasmni almashtirish', ru: 'Заменить изображение', en: 'Replace image' },
    // Design dock
    'cfg.addTextBtn':   { uz: 'Matn qo‘shish', ru: 'Добавить текст', en: 'Add Text' },
    'cfg.uploadDesign': { uz: 'Dizayn yuklash', ru: 'Загрузить дизайн', en: 'Upload Design' },
    // "Загрузить дизайн" (upload art) vs these (save/restore the arrangement) —
    // "макет" keeps them distinguishable next to each other.
    'cfg.saveLayout':   { uz: 'Maketni saqlash', ru: 'Сохранить макет', en: 'Save Layout' },
    'cfg.loadLayout':   { uz: 'Maketni ochish',  ru: 'Открыть макет',   en: 'Load Layout' },
    'cfg.resetLayout':  { uz: 'Tozalash', ru: 'Сброс',     en: 'Reset' },
    'cfg.positionGuide':{ uz: 'Joylashuv sxemasi', ru: 'Схема размещения', en: 'Position Guide' },
    'cfg.guideHint':    { uz: 'Tahrirlash uchun tomonni bosing · maketni surib ko‘chiring', ru: 'Нажмите на сторону, чтобы её редактировать · тяните макет, чтобы двигать', en: 'Click a side to edit it · drag the artwork to move it' },
    /* Flat face editor (the primary editing surface) */
    'cfg.flatHint':     { uz: 'Dizaynni suring — ko‘chirish · burchaklar — o‘lcham · doira — burish', ru: 'Тяните дизайн — двигать · углы — размер · кружок — поворот', en: 'Drag the design to move · corners resize · circle rotates' },
    'cfg.printArea':    { uz: 'chop etish maydoni', ru: 'область печати', en: 'print area' },
    'cfg.emptyAdd':     { uz: 'Dizayn qo‘shish', ru: 'Добавить дизайн', en: 'Add a design' },
    'cfg.addWhat':      { uz: 'Nima qo‘shamiz?', ru: 'Что добавим?', en: 'What shall we add?' },
    'cfg.addImage':     { uz: 'Rasm yuklash', ru: 'Загрузить картинку', en: 'Upload an image' },
    'cfg.addTextOpt':   { uz: 'Matn yozish', ru: 'Написать текст', en: 'Write text' },
    'cfg.view3d':       { uz: '3D ko‘rish', ru: 'Посмотреть в 3D', en: 'View in 3D' },
    'cfg.backToEditor': { uz: 'Muharrir', ru: 'Редактор', en: 'Editor' },
    'cfg.previewCaption': { uz: 'Ko‘rib chiqish', ru: 'Предпросмотр', en: 'Preview' },
    'cfg.undo':         { uz: 'Bekor qilish', ru: 'Отменить', en: 'Undo' },
    /* Mobile sheet steps */
    'cfg.stepDesign':   { uz: 'Dizayn',        ru: 'Дизайн',        en: 'Design' },
    'cfg.stepColorSize':{ uz: 'Rang va o‘lcham', ru: 'Цвет и размер', en: 'Colour & size' },
    'cfg.stepOrder':    { uz: 'Buyurtma',      ru: 'Заказ',         en: 'Order' },
    'cfg.orderBlank':   { uz: 'Bosmasiz buyurtma berish', ru: 'Заказать без принта', en: 'Order without a print' },
    'cfg.deleted':      { uz: 'Qatlam o‘chirildi', ru: 'Слой удалён', en: 'Layer deleted' },
    'cfg.wasReset':     { uz: 'Dizayn tozalandi', ru: 'Дизайн сброшен', en: 'Design was reset' },
    'cfg.layoutSaved':  { uz: 'Maket saqlandi', ru: 'Макет сохранён', en: 'Layout saved' },
    'cfg.layoutLoaded': { uz: 'Maket yuklandi', ru: 'Макет загружен', en: 'Layout loaded' },
    'cfg.layoutNone':   { uz: 'Saqlangan maket yo‘q', ru: 'Сохранённых макетов нет', en: 'No saved layout' },
    'cfg.layoutTooBig': { uz: 'Maket saqlash uchun juda katta', ru: 'Макет слишком большой для сохранения', en: 'Layout too large to save' },
    'cfg.layoutSaveError': { uz: 'Maketni saqlab bo‘lmadi', ru: 'Не удалось сохранить макет', en: 'Could not save layout' },
    'cfg.textLabel':    { uz: 'Futbolkadagi matn', ru: 'Текст на футболке', en: 'Text on shirt' },
    'cfg.textPlaceholder': { uz: 'Matn kiriting…', ru: 'Введите текст…', en: 'Enter text…' },
    'cfg.font':         { uz: 'Shrift',   ru: 'Шрифт',    en: 'Font' },
    'cfg.sizeSlider':   { uz: 'O‘lcham',  ru: 'Размер',   en: 'Size' },
    'cfg.textColor':    { uz: 'Matn rangi', ru: 'Цвет текста', en: 'Text color' },
    'cfg.style':        { uz: 'Uslub',    ru: 'Стиль',    en: 'Style' },
    'cfg.center':       { uz: 'Markazga', ru: 'По центру', en: 'Center' },
    'cfg.removeText':   { uz: 'Matnni o‘chirish', ru: 'Удалить текст', en: 'Remove text' },
    'cfg.uploadTitle':  { uz: 'Logotip yuklash', ru: 'Загрузить логотип', en: 'Upload logo' },
    'cfg.uploadSubtext':{ uz: 'PNG, JPG yoki SVG — bosing yoki sudrang', ru: 'PNG, JPG или SVG — нажмите или перетащите', en: 'PNG, JPG or SVG — click or drag' },
    'cfg.scale':        { uz: 'Masshtab', ru: 'Масштаб',  en: 'Scale' },
    'cfg.remove':       { uz: 'O‘chirish', ru: 'Удалить', en: 'Remove' },
    'cfg.snapshot':     { uz: 'Joriy ko‘rinish tasviri', ru: 'Снимок текущего вида', en: 'Snapshot of current view' },
    'cfg.sumColor':     { uz: 'Rang',     ru: 'Цвет',     en: 'Color' },
    'cfg.sumSize':      { uz: 'O‘lcham',  ru: 'Размер',   en: 'Size' },
    'cfg.sumText':      { uz: 'Matn',     ru: 'Текст',    en: 'Text' },
    'cfg.sumFont':      { uz: 'Shrift',   ru: 'Шрифт',    en: 'Font' },
    'cfg.sumLogo':      { uz: 'Logotip',  ru: 'Логотип',  en: 'Logo' },
    'cfg.notUploaded':  { uz: 'Yuklanmagan', ru: 'Не загружено', en: 'Not uploaded' },
    'cfg.resetDesign':  { uz: 'Dizaynni tiklash', ru: 'Сбросить дизайн', en: 'Reset design' },
    'cfg.total':        { uz: 'Jami',     ru: 'Итого',    en: 'Total' },
    'cfg.addToCart':    { uz: 'Savatga',  ru: 'В корзину', en: 'Add to cart' },
    'cfg.buyNow':       { uz: 'Hozir sotib olish', ru: 'Купить сейчас', en: 'Buy now' },
    'cfg.cartTitle':    { uz: 'Savatcha', ru: 'Корзина',  en: 'Cart' },
    'cfg.cartEmpty':    { uz: 'Bo‘sh. Bittayam narsa yo‘qmi?', ru: 'Пусто. Даже одной вещи нет?', en: 'Empty. Not even one thing?' },
    'cfg.checkout':     { uz: 'Buyurtma berish', ru: 'Оформить заказ', en: 'Checkout' },
    'cfg.viewFront':    { uz: 'Old',      ru: 'Перед',    en: 'Front' },
    'cfg.viewBack':     { uz: 'Orqa',     ru: 'Зад',      en: 'Back' },
    'cfg.changeGarment':{ uz: 'Mahsulotni o‘zgartirish', ru: 'Сменить товар', en: 'Change garment' },
    'cfg.resetView':    { uz: 'Ko‘rinishni tiklash', ru: 'Сброс вида', en: 'Reset view' },
    'cfg.save':         { uz: 'Saqlash',  ru: 'Сохранить', en: 'Save' },
    'cfg.loading3d':    { uz: '3D model yuklanmoqda…', ru: 'Загрузка 3D модели…', en: 'Loading 3D model…' },
    'cfg.load3dFailed': { uz: '3D ko‘rinishni yuklab bo‘lmadi', ru: 'Не удалось загрузить 3D-превью', en: 'Could not load the 3D preview' },
    'cfg.retry':        { uz: 'Qayta urinish', ru: 'Повторить', en: 'Try again' },
    'cfg.colorWhite':   { uz: 'Oq',       ru: 'Белый',    en: 'White' },
    'cfg.colorBlack':   { uz: 'Qora',     ru: 'Чёрный',   en: 'Black' },
    'cfg.toastAddedCart':  { uz: 'Savatga qo‘shildi', ru: 'Добавлено в корзину', en: 'Added to cart' },
    'cfg.preparing':       { uz: 'Maketlar tayyorlanmoqda…', ru: 'Готовим макеты…', en: 'Preparing proofs…' },
    'cfg.toastLoginCart':  { uz: 'Savatga qo‘shish uchun tizimga kiring', ru: 'Войдите, чтобы добавить в корзину', en: 'Sign in to add to cart' },
    'cfg.toastAddError':   { uz: 'Qo‘shishda xatolik', ru: 'Ошибка добавления', en: 'Could not add item' },
    'cfg.toastCartUpdated':{ uz: 'Savat yangilandi', ru: 'Корзина обновлена', en: 'Cart updated' },
    'cfg.editingFromCart': { uz: 'Savatdagi mahsulot tahrirlanmoqda — qo‘shilganda saqlanadi', ru: 'Редактируем товар из корзины — сохранится при добавлении', en: 'Editing a bag item — re-add to save changes' },

    // ===== Bag (shared cart drawer) =====
    'cart.edit':    { uz: 'O‘zgartirish', ru: 'Изменить',  en: 'Edit' },
    'cart.remove':  { uz: 'O‘chirish',    ru: 'Удалить',   en: 'Remove' },
    'cart.plain':   { uz: 'Printsiz',     ru: 'Без принта', en: 'No print' },
    'cart.item':    { uz: 'Futbolka',     ru: 'Футболка',  en: 'T-shirt' },
    'cart.size':    { uz: 'O‘lcham',      ru: 'Размер',    en: 'Size' },
    'cart.added':   { uz: 'Savatga qo‘shildi', ru: 'Добавлено в корзину', en: 'Added to bag' },

    // ===== Checkout page =====
    'co.title':        { uz: 'Buyurtmani rasmiylashtirish', ru: 'Оформление заказа', en: 'Checkout' },
    'co.contact':      { uz: 'Aloqa ma’lumotlari', ru: 'Контактные данные', en: 'Contact details' },
    'co.name':         { uz: 'Ism',           ru: 'Имя',        en: 'First name' },
    'co.surname':      { uz: 'Familiya',      ru: 'Фамилия',    en: 'Last name' },
    'co.phone':        { uz: 'Telefon raqami', ru: 'Номер телефона', en: 'Phone number' },
    'co.phoneOk':      { uz: 'Tasdiqlangan',  ru: 'Подтверждён', en: 'Verified' },
    'co.phoneWarn':    { uz: 'Buyurtma uchun raqamni Telegram orqali tasdiqlang', ru: 'Для заказа подтвердите номер через Telegram', en: 'Verify your number via Telegram to order' },
    'co.delivery':     { uz: 'Yetkazib berish', ru: 'Доставка',  en: 'Delivery' },
    'co.savedAddr':    { uz: 'Saqlangan manzil', ru: 'Сохранённый адрес', en: 'Saved address' },
    'co.entrance':     { uz: 'Kirish (podyezd)', ru: 'Подъезд',  en: 'Entrance' },
    'co.apartment':    { uz: 'Xonadon',       ru: 'Квартира',   en: 'Apartment' },
    'co.floor':        { uz: 'Qavat',         ru: 'Этаж',       en: 'Floor' },
    'co.intercom':     { uz: 'Domofon',       ru: 'Домофон',    en: 'Intercom' },
    'co.courierNote':  { uz: 'Kuryer uchun izoh', ru: 'Комментарий курьеру', en: 'Note for courier' },
    'co.payment':      { uz: 'To‘lov usuli',  ru: 'Способ оплаты', en: 'Payment method' },
    'co.cod':          { uz: 'Qabul qilishda to‘lov', ru: 'При получении', en: 'On delivery' },
    'co.codHint':      { uz: 'Naqd yoki karta orqali', ru: 'Наличными или картой', en: 'Cash or card' },
    'co.soon':         { uz: 'Tez orada',     ru: 'Скоро',      en: 'Soon' },
    'co.orderComment': { uz: 'Buyurtmaga izoh', ru: 'Комментарий к заказу', en: 'Order comment' },
    'co.optional':     { uz: 'ixtiyoriy',     ru: 'необязательно', en: 'optional' },
    'co.summary':      { uz: 'Sizning buyurtmangiz', ru: 'Ваш заказ', en: 'Your order' },
    'co.subtotal':     { uz: 'Mahsulotlar',   ru: 'Товары',     en: 'Items' },
    'co.deliveryFee':  { uz: 'Yetkazib berish', ru: 'Доставка', en: 'Delivery' },
    'co.free':         { uz: 'Bepul',         ru: 'Бесплатно',  en: 'Free' },
    'co.total':        { uz: 'Jami',          ru: 'Итого',      en: 'Total' },
    'co.place':        { uz: 'Buyurtma berish', ru: 'Оформить заказ', en: 'Place order' },
    'co.placing':      { uz: 'Yuborilmoqda…', ru: 'Оформляем…', en: 'Placing…' },
    'co.terms':        { uz: 'Buyurtma berish orqali siz yetkazib berish shartlariga rozilik bildirasiz', ru: 'Оформляя заказ, вы соглашаетесь с условиями доставки', en: 'By placing an order you agree to the delivery terms' },
    'co.needName':     { uz: 'Ismingizni kiriting', ru: 'Укажите имя', en: 'Enter your name' },
    'co.needPhone':    { uz: 'To‘g‘ri raqam kiriting', ru: 'Укажите корректный номер', en: 'Enter a valid phone' },
    'co.needAddr':     { uz: 'Xaritada manzilni belgilang', ru: 'Укажите адрес на карте', en: 'Pick your address on the map' },
    'co.empty':        { uz: 'Savat bo‘sh',   ru: 'Корзина пуста', en: 'Your bag is empty' },
    'co.emptyCta':     { uz: 'Katalogga o‘tish', ru: 'Перейти в каталог', en: 'Browse the catalog' },
    'co.successTitle': { uz: 'Buyurtma qabul qilindi!', ru: 'Заказ принят!', en: 'Order received!' },
    'co.successNum':   { uz: 'Buyurtma raqami', ru: 'Номер заказа', en: 'Order number' },
    'co.successText':  { uz: 'Tez orada siz bilan bog‘lanamiz. Holatini shaxsiy kabinetda kuzatishingiz mumkin.', ru: 'Мы скоро свяжемся с вами. Статус можно отслеживать в личном кабинете.', en: 'We will contact you shortly. Track the status in your account.' },
    'co.toAccount':    { uz: 'Shaxsiy kabinet', ru: 'Личный кабинет', en: 'My account' },
    'co.toCatalog':    { uz: 'Katalogga qaytish', ru: 'Вернуться в каталог', en: 'Back to catalog' },
    'co.errGeneric':   { uz: 'Buyurtma yuborilmadi. Qayta urinib ko‘ring.', ru: 'Не удалось оформить заказ. Попробуйте ещё раз.', en: 'Could not place the order. Please try again.' },
    'co.errNetwork':   { uz: 'Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.', ru: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.', en: 'No connection to the server. Check your internet and try again.' },
    'co.errBootTitle': { uz: 'Nimadir noto‘g‘ri ketdi', ru: 'Что-то пошло не так', en: 'Something went wrong' },
    'co.errBoot':      { uz: 'Buyurtma sahifasini yuklab bo‘lmadi. Sahifani yangilang.', ru: 'Не удалось загрузить оформление заказа. Обновите страницу.', en: 'Could not load checkout. Please refresh the page.' },
    'co.retry':        { uz: 'Yangilash',     ru: 'Обновить',   en: 'Refresh' },
    'co.sessionLost':  { uz: 'Sessiya tugadi. Buyurtma berish uchun qayta kiring.', ru: 'Сессия истекла. Войдите заново, чтобы оформить заказ.', en: 'Your session expired. Sign in again to place the order.' },
    'co.verifyCta':    { uz: 'Telegram orqali tasdiqlash', ru: 'Подтвердить через Telegram', en: 'Verify via Telegram' },
    'co.addrPending':  { uz: 'Manzil aniqlanmoqda — bir soniya kuting', ru: 'Определяем адрес — подождите секунду', en: 'Resolving the address — one moment' },
    'co.needAddrManual': { uz: 'Yetkazib berish manzilini kiriting', ru: 'Укажите адрес доставки', en: 'Enter your delivery address' },
    'co.addrPh':       { uz: 'Ko‘cha, uy, mo‘ljal', ru: 'Улица, дом, ориентир', en: 'Street, building, landmark' },
    'co.mapOffline':   { uz: 'Xarita mavjud emas. Manzilni qo‘lda kiriting — kuryer aniqlashtirish uchun bog‘lanadi.', ru: 'Карта недоступна. Введите адрес вручную — курьер свяжется с вами для уточнения.', en: 'The map is unavailable. Enter your address manually — the courier will confirm it with you.' },

    // ===== Address picker =====
    'addr.searchPh': { uz: 'Ko‘cha, uy — yozishni boshlang…', ru: 'Улица, дом — начните вводить…', en: 'Street, building — start typing…' },
    'addr.moveMap':  { uz: 'Nuqtani belgilash uchun xaritani suring', ru: 'Передвиньте карту, чтобы указать точку', en: 'Move the map to drop the pin' },
    'addr.locating': { uz: 'Manzil aniqlanmoqda…', ru: 'Определяем адрес…', en: 'Locating…' },
    'addr.locate':   { uz: 'Mening joylashuvim', ru: 'Моё местоположение', en: 'My location' },
    'addr.geoFail':  { uz: 'Joylashuvni aniqlab bo‘lmadi', ru: 'Не удалось определить местоположение', en: 'Could not get your location' },

    // ===== Size guide =====
    'sg.toggle':     { uz: 'O‘lchamlar haqida batafsil', ru: 'Подробнее о размерах', en: 'More about sizes' },
    'sg.intro':      { uz: 'XS–XL belgilari tushunarsizmi? Quyida xalqaro o‘lcham jadvali va o‘lchamlarni qanday olish ko‘rsatilgan.', ru: 'Не понимаете обозначения XS–XL? Ниже — таблица международных размеров и как снять мерки.', en: 'Not sure what XS–XL mean? Below is an international size chart and how to measure.' },
    'sg.colSize':    { uz: 'O‘lcham', ru: 'Размер', en: 'Size' },
    'sg.colChest':   { uz: 'Ko‘krak (sm)', ru: 'Обхват груди (см)', en: 'Chest (cm)' },
    'sg.colLength':  { uz: 'Uzunlik (sm)', ru: 'Длина (см)', en: 'Length (cm)' },
    'sg.intl':       { uz: 'Xalqaro standartlar', ru: 'Международные стандарты', en: 'International standards' },
    'sg.measure':    { uz: 'Qanday o‘lchanadi', ru: 'Как снять мерки', en: 'How to measure' },
    'sg.measureChest':  { uz: 'Ko‘krak: qo‘ltiq ostidan ko‘krakning eng keng joyidan o‘lchang.', ru: 'Грудь: измерьте по самой широкой части груди под подмышками.', en: 'Chest: measure around the fullest part of the chest, under the arms.' },
    'sg.measureLength': { uz: 'Uzunlik: yelka choqidan futbolkaning past chetigacha.', ru: 'Длина: от шва плеча до нижнего края футболки.', en: 'Length: from the shoulder seam to the bottom hem.' },
    'sg.tip':        { uz: 'Maslahat: ikki o‘lcham orasida bo‘lsangiz, erkinroq fason uchun kattaroq o‘lchamni tanlang.', ru: 'Совет: если вы между размерами, берите больший для свободной посадки.', en: 'Tip: between two sizes? Pick the larger one for a relaxed fit.' },

    // ===== Order modal =====
    'order.title':       { uz: 'Buyurtma berish', ru: 'Оформление заказа', en: 'Checkout' },
    'order.yourOrder':   { uz: 'Sizning buyurtmangiz', ru: 'Ваш заказ', en: 'Your order' },
    'order.color':       { uz: 'Rang:',     ru: 'Цвет:',    en: 'Color:' },
    'order.size':        { uz: 'O‘lcham:',  ru: 'Размер:',  en: 'Size:' },
    'order.scale':       { uz: 'Masshtab:', ru: 'Масштаб:', en: 'Scale:' },
    'order.text':        { uz: 'Matn:',     ru: 'Текст:',   en: 'Text:' },
    'order.font':        { uz: 'Shrift:',   ru: 'Шрифт:',   en: 'Font:' },
    'order.logo':        { uz: 'Logotip:',  ru: 'Логотип:', en: 'Logo:' },
    'order.price':       { uz: 'Narx:',     ru: 'Цена:',    en: 'Price:' },
    'order.textNone':    { uz: 'Ko‘rsatilmagan', ru: 'Не указан', en: 'None' },
    'order.bound':       { uz: '✓ Buyurtma akkauntingizga bog‘lanadi', ru: '✓ Заказ будет привязан к вашему аккаунту', en: '✓ This order will be linked to your account' },
    'order.name':        { uz: 'Ism',       ru: 'Имя',      en: 'First name' },
    'order.namePh':      { uz: 'Ismingizni kiriting', ru: 'Введите ваше имя', en: 'Enter your name' },
    'order.surname':     { uz: 'Familiya',  ru: 'Фамилия',  en: 'Last name' },
    'order.optional':    { uz: 'Ixtiyoriy', ru: 'Необязательно', en: 'Optional' },
    'order.phone':       { uz: 'Telefon',   ru: 'Телефон',  en: 'Phone' },
    'order.comment':     { uz: 'Buyurtmaga izoh', ru: 'Комментарий к заказу', en: 'Order comment' },
    'order.commentPh':   { uz: 'O‘lcham, qo‘shimcha istaklar…', ru: 'Укажите размер, дополнительные пожелания…', en: 'Size, extra requests…' },
    'order.commentHint': { uz: 'Ixtiyoriy, 500 belgigacha', ru: 'Необязательно, до 500 символов', en: 'Optional, up to 500 characters' },
    'order.address':     { uz: 'Yetkazib berish manzili', ru: 'Адрес доставки', en: 'Delivery address' },
    'order.savedTitle':  { uz: 'Saqlangan manzil', ru: 'Сохранённый адрес', en: 'Saved address' },
    'order.useSaved':    { uz: 'Saqlangandan foydalanish', ru: 'Использовать сохранённый', en: 'Use saved' },
    'order.enterNew':    { uz: 'Yangi kiritish', ru: 'Ввести новый', en: 'Enter new' },
    'order.onMap':       { uz: '📍 Xaritada', ru: '📍 На карте', en: '📍 On map' },
    'order.addressTab':  { uz: '✏️ Manzil', ru: '✏️ Адрес', en: '✏️ Address' },
    'order.addressPh':   { uz: 'Toshkent, Amir Temur ko‘chasi, 10-uy', ru: 'Ташкент, улица Амира Темура, дом 10', en: 'Tashkent, Amir Temur street, 10' },
    'order.submit':      { uz: 'Buyurtma berish', ru: 'Оформить заказ', en: 'Place order' },
    'order.sending':     { uz: 'Yuborilmoqda…', ru: 'Отправка…', en: 'Sending…' },
    'order.success':     { uz: 'Buyurtma muvaffaqiyatli berildi!', ru: 'Заказ успешно оформлен!', en: 'Order placed successfully!' },

    // ===== Account =====
    'acc.pageTitle':   { uz: 'Shaxsiy kabinet', ru: 'Личный кабинет', en: 'My account' },
    'acc.tabProfile':  { uz: 'Profil',     ru: 'Профиль',     en: 'Profile' },
    'acc.tabOrders':   { uz: 'Buyurtmalar', ru: 'Заказы',     en: 'Orders' },
    'acc.tabNotif':    { uz: 'Bildirishnomalar', ru: 'Уведомления', en: 'Notifications' },
    'acc.tabSettings': { uz: 'Sozlamalar', ru: 'Настройки',   en: 'Settings' },
    'acc.myProfile':   { uz: 'Mening profilim', ru: 'Мой профиль', en: 'My profile' },
    'acc.statOrders':  { uz: 'Buyurtmalar', ru: 'Заказов',    en: 'Orders' },
    'acc.statSpent':   { uz: 'Sarflangan', ru: 'Потрачено',   en: 'Spent' },
    'acc.statSince':   { uz: 'Biz bilan',  ru: 'С нами с',    en: 'Member since' },
    'acc.defaultAddr': { uz: 'Yetkazib berish manzili (asosiy)', ru: 'Адрес доставки (по умолчанию)', en: 'Delivery address (default)' },
    'acc.enterAddr':   { uz: 'Manzilni kiriting', ru: 'Введите адрес', en: 'Enter address' },
    'acc.find':        { uz: 'Topish',     ru: 'Найти',       en: 'Find' },
    'acc.pickOnMap':   { uz: '📍 Xaritada tanlash', ru: '📍 Выбрать на карте', en: '📍 Pick on map' },
    'acc.saveAddr':    { uz: 'Manzilni saqlash', ru: 'Сохранить адрес', en: 'Save address' },
    'acc.clear':       { uz: 'Tozalash',   ru: 'Очистить',    en: 'Clear' },
    'acc.myGeo':       { uz: 'Mening joylashuvim', ru: 'Моя геолокация', en: 'My location' },
    'acc.addrSaved':   { uz: 'Manzil saqlandi!', ru: 'Адрес сохранён!', en: 'Address saved!' },
    'acc.catalogLink': { uz: 'Katalog →', ru: 'Каталог →', en: 'Catalog →' },
    'acc.designLink':  { uz: 'Dizayn yaratish →', ru: 'Создать дизайн →', en: 'Start designing →' },
    'acc.orderHistory':{ uz: 'Buyurtmalar tarixi', ru: 'История заказов', en: 'Order history' },
    'acc.loading':     { uz: 'Yuklanmoqda…', ru: 'Загрузка…', en: 'Loading…' },
    'acc.notifTitle':  { uz: 'LOOM bildirishnomalari', ru: 'Уведомления от LOOM', en: 'Notifications from LOOM' },
    'acc.editProfile': { uz: 'Profilni tahrirlash', ru: 'Редактировать профиль', en: 'Edit profile' },
    'acc.fieldName':   { uz: 'Ism',        ru: 'Имя',         en: 'Name' },
    'acc.fieldPhone':  { uz: 'Telefon',    ru: 'Телефон',     en: 'Phone' },
    'acc.save':        { uz: 'Saqlash',    ru: 'Сохранить',   en: 'Save' },
    'acc.changePw':    { uz: 'Parolni o‘zgartirish', ru: 'Изменить пароль', en: 'Change password' },
    'acc.pwCurrent':   { uz: 'Joriy parol', ru: 'Текущий пароль', en: 'Current password' },
    'acc.pwNew':       { uz: 'Yangi parol', ru: 'Новый пароль', en: 'New password' },
    'acc.pwMin':       { uz: 'kamida 8 belgi', ru: 'мин. 8 символов', en: 'min. 8 characters' },
    'acc.pwConfirm':   { uz: 'Tasdiqlash', ru: 'Подтвердить', en: 'Confirm' },
    'acc.pwUpdate':    { uz: 'Parolni yangilash', ru: 'Обновить пароль', en: 'Update password' },
    'acc.notifPrefs':  { uz: 'Bildirishnomalar', ru: 'Уведомления', en: 'Notifications' },
    'acc.notifOrder':  { uz: 'Buyurtma holati', ru: 'Статус заказа', en: 'Order status' },
    'acc.notifOrderSub': { uz: 'Buyurtmangiz yangi bosqichga o‘tganda', ru: 'Когда ваш заказ перейдёт на новый этап', en: 'When your order moves to a new stage' },
    'acc.notifPromo':  { uz: 'Aksiya va yangiliklar', ru: 'Акции и новинки', en: 'Promotions & news' },
    'acc.notifPromoSub': { uz: 'Yangi mahsulotlar va maxsus takliflar', ru: 'Новые продукты и специальные предложения', en: 'New products and special offers' },

    // ===== Telegram Mini App onboarding (tma.js) =====
    'tma.welcome':      { uz: 'LOOM’ga xush kelibsiz', ru: 'Добро пожаловать в LOOM', en: 'Welcome to LOOM' },
    'tma.sub':          { uz: 'Telegram orqali kirdingiz. Ma’lumotlarni tekshiring — buyurtmada shu ism ko‘rsatiladi.', ru: 'Вы вошли через Telegram. Проверьте данные — это имя мы укажем в заказе.', en: 'You are signed in with Telegram. Check your details — this name goes on your order.' },
    'tma.fullName':     { uz: 'To‘liq ism', ru: 'Полное имя', en: 'Full name' },
    'tma.namePh':       { uz: 'Ism va familiya', ru: 'Имя и фамилия', en: 'First and last name' },
    'tma.share':        { uz: 'Raqamni ulashish', ru: 'Поделиться номером', en: 'Share my number' },
    'tma.phoneWhy':     { uz: 'Raqam yetkazib berish uchun kerak. Keyinroq ham qo‘shsa bo‘ladi.', ru: 'Номер нужен для доставки. Можно добавить позже.', en: 'We need your number for delivery. You can add it later.' },
    'tma.later':        { uz: 'Keyinroq', ru: 'Позже', en: 'Later' },
    'tma.saving':       { uz: 'Saqlanmoqda…', ru: 'Сохраняем…', en: 'Saving…' },
    'tma.done':         { uz: 'Hammasi tayyor!', ru: 'Всё готово!', en: 'All set!' },
    'tma.doneSub':      { uz: 'Endi dizayn yaratishni boshlashingiz mumkin.', ru: 'Можно приступать к созданию дизайна.', en: 'You can start designing now.' },
    'tma.errShare':     { uz: 'Raqam olinmadi. Yana urinib ko‘ring.', ru: 'Не удалось получить номер. Попробуйте снова.', en: 'Could not get your number. Please try again.' },
    'tma.close':        { uz: 'Yopish', ru: 'Закрыть', en: 'Close' },

    // ===== Auth (login / register) =====
    'auth.loginTitle':  { uz: 'Akkauntga kirish', ru: 'Вход в аккаунт', en: 'Sign in' },
    'auth.loginSub':    { uz: 'Buyurtmalarni kuzatish uchun kiring', ru: 'Войдите, чтобы отслеживать заказы', en: 'Sign in to track your orders' },
    'auth.email':       { uz: 'Email', ru: 'Email', en: 'Email' },
    'auth.password':    { uz: 'Parol', ru: 'Пароль', en: 'Password' },
    'auth.loginBtn':    { uz: 'Kirish', ru: 'Войти', en: 'Sign in' },
    'auth.loggingIn':   { uz: 'Kirilmoqda…', ru: 'Вход…', en: 'Signing in…' },
    'auth.noAccount':   { uz: 'Akkauntingiz yo‘qmi?', ru: 'Нет аккаунта?', en: 'No account?' },
    'auth.register':    { uz: 'Ro‘yxatdan o‘tish', ru: 'Зарегистрироваться', en: 'Sign up' },
    'auth.regTitle':    { uz: 'Akkaunt yaratish', ru: 'Создать аккаунт', en: 'Create account' },
    'auth.regSub':      { uz: 'Buyurtmalarni kuzating va dizaynlarni saqlang', ru: 'Отслеживайте заказы и сохраняйте дизайны', en: 'Track orders and save your designs' },
    'auth.name':        { uz: 'Ism', ru: 'Имя', en: 'Name' },
    'auth.phone':       { uz: 'Telefon', ru: 'Телефон', en: 'Phone' },
    'auth.pwMin8':      { uz: 'Kamida 8 belgi', ru: 'Минимум 8 символов', en: 'Minimum 8 characters' },
    'auth.regBtn':      { uz: 'Ro‘yxatdan o‘tish', ru: 'Зарегистрироваться', en: 'Sign up' },
    'auth.registering': { uz: 'Ro‘yxatdan o‘tilmoqda…', ru: 'Регистрация…', en: 'Signing up…' },
    'auth.haveAccount': { uz: 'Akkauntingiz bormi?', ru: 'Уже есть аккаунт?', en: 'Already have an account?' },
    'auth.errEmail':    { uz: 'To‘g‘ri email kiriting', ru: 'Введите корректный email', en: 'Enter a valid email' },
    'auth.errPw':       { uz: 'Parolni kiriting', ru: 'Введите пароль', en: 'Enter your password' },
    'auth.errPwLen':    { uz: 'Parol kamida 8 belgidan iborat bo‘lishi kerak', ru: 'Пароль должен содержать минимум 8 символов', en: 'Password must be at least 8 characters' },

    // Telegram-verified sign up / sign in
    'auth.viaTelegram':   { uz: 'Telegram orqali davom etish', ru: 'Продолжить через Telegram', en: 'Continue with Telegram' },
    'auth.tgHint':        { uz: 'Telefon raqamingizni Telegram orqali tasdiqlaymiz — tez va parolsiz.', ru: 'Подтвердим ваш номер через Telegram — быстро и без пароля.', en: 'We verify your number via Telegram — fast and password-free.' },
    'auth.orEmail':       { uz: 'yoki email orqali', ru: 'или по email', en: 'or with email' },

    // Social sign-in (assets/oauth.js). Which of these ever render is decided
    // by the Worker — a provider without credentials is never drawn.
    'auth.viaGoogle':      { uz: 'Google orqali davom etish', ru: 'Продолжить через Google', en: 'Continue with Google' },
    'auth.viaDiscord':     { uz: 'Discord orqali davom etish', ru: 'Продолжить через Discord', en: 'Continue with Discord' },
    'auth.viaFacebook':    { uz: 'Facebook orqali davom etish', ru: 'Продолжить через Facebook', en: 'Continue with Facebook' },
    'auth.oauthWorking':   { uz: 'Kirish yakunlanmoqda…', ru: 'Завершаем вход…', en: 'Finishing sign-in…' },
    'auth.oauthWorkingSub':{ uz: 'Bir soniya — profilingizni tasdiqlaymiz.', ru: 'Секунду — подтверждаем ваш профиль.', en: 'One moment — confirming your profile.' },
    'auth.oauthFailedTitle': { uz: 'Kirib bo‘lmadi', ru: 'Не удалось войти', en: 'Sign-in failed' },
    'auth.oauthFailed':    { uz: 'Bu xizmat orqali kirib bo‘lmadi', ru: 'Не удалось войти через этот сервис', en: 'Could not sign in with this service' },
    'auth.oauthCancelled': { uz: 'Kirish bekor qilindi', ru: 'Вход отменён', en: 'Sign-in cancelled' },
    'auth.oauthBackToLogin': { uz: '← Kirish sahifasiga qaytish', ru: '← Вернуться ко входу', en: '← Back to sign-in' },
    'order.verifyPhone':  { uz: 'Buyurtma berish uchun raqamingizni Telegram orqali tasdiqlang.', ru: 'Чтобы оформить заказ, подтвердите номер телефона через Telegram.', en: 'Verify your phone via Telegram to place an order.' },

    // Forgot-password recovery
    'auth.forgot':     { uz: 'Parolni unutdingizmi?', ru: 'Забыли пароль?', en: 'Forgot password?' },
    'auth.errPhone':   { uz: 'To‘liq telefon raqamini kiriting', ru: 'Введите полный номер телефона', en: 'Enter the full phone number' },
    'reset.title':     { uz: 'Kirishni tiklash', ru: 'Восстановление доступа', en: 'Recover access' },
    'reset.phoneHint': { uz: 'Telefon raqamingizni kiriting — uni Telegramda tasdiqlang, so‘ng yangi parol o‘rnating.', ru: 'Введите номер телефона — подтвердите его в Telegram, затем задайте новый пароль.', en: 'Enter your phone — confirm it in Telegram, then set a new password.' },
    'reset.waitHint':  { uz: 'Botni oching, «Start» bosing va raqamingizni ulashing. Tasdiqlash kutilmoqda…', ru: 'Откройте бота, нажмите «Старт» и поделитесь номером. Ожидаем подтверждение…', en: 'Open the bot, tap Start and share your number. Waiting for confirmation…' },
    'reset.openBot':   { uz: 'Telegramni qayta ochish', ru: 'Открыть Telegram ещё раз', en: 'Open Telegram again' },
    'reset.expired':   { uz: 'Vaqt tugadi. Qaytadan urinib ko‘ring.', ru: 'Время ожидания истекло. Попробуйте снова.', en: 'Timed out. Please try again.' },
    'reset.notFound':  { uz: 'Akkaunt topilmadi yoki raqam mos kelmadi.', ru: 'Аккаунт не найден или номер не совпал.', en: 'Account not found or the number did not match.' },
    'reset.verified':  { uz: 'Raqam tasdiqlandi. Yangi parol o‘rnating.', ru: 'Номер подтверждён. Задайте новый пароль.', en: 'Number verified. Set a new password.' },
    'reset.newPw':     { uz: 'Yangi parol (kamida 8)', ru: 'Новый пароль (мин. 8)', en: 'New password (min. 8)' },
    'reset.confirmPw': { uz: 'Parolni takrorlang', ru: 'Повторите пароль', en: 'Repeat password' },
    'reset.setBtn':    { uz: 'Parolni saqlash', ru: 'Сохранить пароль', en: 'Save password' },
    'reset.mismatch':  { uz: 'Parollar mos kelmadi', ru: 'Пароли не совпадают', en: 'Passwords do not match' },
    'reset.done':      { uz: 'Parol yangilandi! Endi yangi parol bilan kiring.', ru: 'Пароль обновлён! Теперь войдите с новым паролем.', en: 'Password updated! Sign in with your new password.' },
    'reset.toLogin':   { uz: 'Kirish', ru: 'Войти', en: 'Sign in' }
  };

  // ── Core ──────────────────────────────────────────────────────
  function getLang() {
    try { const l = localStorage.getItem(STORE_KEY); if (LANGS.indexOf(l) !== -1) return l; } catch (e) {}
    return DEFAULT;
  }

  function t(key, lang) {
    lang = lang || getLang();
    const entry = DICT[key];
    if (!entry) return key;
    return (entry[lang] != null) ? entry[lang] : (entry[DEFAULT] != null ? entry[DEFAULT] : key);
  }

  function applyTo(root, lang) {
    lang = lang || getLang();
    root = root || document;

    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (DICT[key]) el.textContent = t(key, lang);
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-html');
      if (DICT[key]) el.innerHTML = t(key, lang);
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        pair = pair.trim(); if (!pair) return;
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (DICT[key]) el.setAttribute(attr, t(key, lang));
      });
    });
  }

  function apply(lang) {
    lang = lang || getLang();
    document.documentElement.setAttribute('lang', lang);
    applyTo(document, lang);
    document.querySelectorAll('.lang-current').forEach(function (el) { el.textContent = LANG_SHORT[lang]; });
    document.querySelectorAll('.lang-option').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-lang') === lang);
    });
    try { window.dispatchEvent(new CustomEvent('loom:langchange', { detail: { lang: lang } })); } catch (e) {}
  }

  function setLang(lang) {
    if (LANGS.indexOf(lang) === -1) return;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    apply(lang);
  }

  function formatPrice(n, lang) {
    lang = lang || getLang();
    var num = Number(n || 0);
    var grouped;
    try { grouped = num.toLocaleString('ru-RU'); } catch (e) { grouped = String(num); }
    return grouped + ' ' + t('cfg.currency', lang);
  }

  // ── Language switcher UI ──────────────────────────────────────
  function buildSwitcher(mount) {
    if (!mount || mount.dataset.langBuilt) return;
    mount.dataset.langBuilt = '1';
    var cur = getLang();
    var wrap = document.createElement('div');
    wrap.className = 'lang-switcher';
    wrap.innerHTML =
      '<button class="lang-btn" aria-haspopup="true" aria-expanded="false" aria-label="' + t('nav.language') + '">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></svg>' +
        '<span class="lang-current">' + LANG_SHORT[cur] + '</span>' +
        '<svg class="lang-caret" width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<div class="lang-menu" role="menu">' +
        LANGS.map(function (l) {
          return '<button class="lang-option' + (l === cur ? ' active' : '') + '" data-lang="' + l + '" role="menuitem">' + LANG_LABELS[l] + '</button>';
        }).join('') +
      '</div>';

    mount.appendChild(wrap);

    var btn = wrap.querySelector('.lang-btn');
    var menu = wrap.querySelector('.lang-menu');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function () {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
    wrap.querySelectorAll('.lang-option').forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        setLang(opt.getAttribute('data-lang'));
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function initSwitchers() {
    document.querySelectorAll('.lang-switcher-mount').forEach(buildSwitcher);
  }

  function boot() {
    initSwitchers();
    apply(getLang());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.LOOM_I18N = {
    getLang: getLang, setLang: setLang, t: t, apply: apply,
    applyTo: applyTo, formatPrice: formatPrice, initSwitchers: initSwitchers,
    LANGS: LANGS
  };
})();

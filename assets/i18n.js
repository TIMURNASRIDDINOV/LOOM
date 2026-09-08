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
    'nav.market':     { uz: 'Market',      ru: 'Маркет',        en: 'Market' },
    'nav.lab':        { uz: 'LOOM Lab',    ru: 'LOOM Lab',      en: 'LOOM Lab' },
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
    'footer.designersTitle': { uz: 'Dizaynerlarga', ru: 'Дизайнерам', en: 'For designers' },
    'footer.becomeDesigner': { uz: 'Dizayner bo‘lish', ru: 'Стать дизайнером', en: 'Become a designer' },
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
    'cfg.eyebrow':      { uz: 'Konstruktor', ru: 'Конфигуратор', en: 'Configurator' },
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
    // ── Guided steps: each one says what it wants, in a sentence ──
    'cfg.stepCount1':   { uz: '1-qadam / 3', ru: 'Шаг 1 из 3', en: 'Step 1 of 3' },
    'cfg.stepCount2':   { uz: '2-qadam / 3', ru: 'Шаг 2 из 3', en: 'Step 2 of 3' },
    'cfg.stepCount3':   { uz: '3-qadam / 3', ru: 'Шаг 3 из 3', en: 'Step 3 of 3' },
    'cfg.step1Title':   { uz: 'Nima bosamiz?', ru: 'Что напечатать?', en: 'What shall we print?' },
    'cfg.step1Lead':    { uz: 'Rasm yuklang yoki matn yozing — futbolkada darhol ko‘rinadi.', ru: 'Загрузите картинку или напишите текст — вы сразу увидите её на футболке.', en: 'Upload a picture or write some text — you will see it on the shirt straight away.' },
    'cfg.step2Title':   { uz: 'Rang va o‘lcham', ru: 'Цвет и размер', en: 'Colour and size' },
    'cfg.step2Lead':    { uz: 'Mato rangini tanlash uchun doirachani bosing va o‘z o‘lchamingizni tanlang.', ru: 'Нажмите на кружок, чтобы сменить цвет ткани, и выберите свой размер.', en: 'Tap a circle to change the fabric colour, then pick your size.' },
    'cfg.step3Title':   { uz: 'Tekshiring va buyurtma bering', ru: 'Проверьте и закажите', en: 'Check it and order' },
    'cfg.step3Lead':    { uz: 'Hammasi joyidami? Pastdagi katta tugmani bosing — tikib, yetkazib beramiz.', ru: 'Всё верно? Нажмите большую кнопку внизу — мы сошьём и привезём.', en: 'All good? Press the big button below — we will make it and deliver.' },
    'cfg.addImageSub':  { uz: 'Rasm, logotip yoki chizma', ru: 'Фото, логотип или рисунок', en: 'A photo, a logo or a drawing' },
    'cfg.addTextSub':   { uz: 'Ism, yozuv yoki tilak', ru: 'Имя, надпись или пожелание', en: 'A name, a slogan or a wish' },
    'cfg.nextColor':    { uz: 'Keyingisi: rang va o‘lcham', ru: 'Дальше: цвет и размер', en: 'Next: colour and size' },
    'cfg.nextOrder':    { uz: 'Keyingisi: buyurtma', ru: 'Дальше: заказ', en: 'Next: your order' },
    'cfg.nextColorShort': { uz: 'Keyingisi: rang', ru: 'Дальше: цвет', en: 'Next: colour' },
    'cfg.nextOrderShort': { uz: 'Keyingisi: buyurtma', ru: 'Дальше: заказ', en: 'Next: order' },
    'cfg.moreActions':  { uz: 'Yana', ru: 'Ещё', en: 'More' },
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
    'order.onMap':       { uz: 'Xaritada', ru: 'На карте', en: 'On map' },
    'order.addressTab':  { uz: 'Manzil', ru: 'Адрес', en: 'Address' },
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
    'acc.tabDesigner': { uz: 'Dizayner',   ru: 'Дизайнер',    en: 'Designer' },
    'acc.saved':       { uz: 'Saqlandi!',  ru: 'Сохранено!',  en: 'Saved!' },
    'acc.noPassword':  { uz: 'Siz {via} orqali kirasiz — bu akkaunt uchun parol ishlatilmaydi.', ru: 'Вы входите через {via} — пароль для этого аккаунта не используется.', en: 'You sign in with {via} — this account does not use a password.' },
    'acc.viaTelegram': { uz: 'Telegram',   ru: 'Telegram',    en: 'Telegram' },
    'acc.viaSocial':   { uz: 'ijtimoiy tarmoq akkaunti', ru: 'аккаунт социальной сети', en: 'a social account' },
    'acc.deleteTitle': { uz: 'Akkauntni o‘chirish', ru: 'Удалить аккаунт', en: 'Delete account' },
    'acc.deleteLead':  { uz: 'Profil, manzil va yuklangan fayllar butunlay o‘chiriladi. Rasmiylashtirilgan buyurtmalar buxgalteriyada shaxssiz ko‘rinishda qoladi.', ru: 'Профиль, адрес и загруженные файлы будут удалены безвозвратно. Оформленные заказы останутся в бухгалтерии в обезличенном виде.', en: 'Your profile, address and uploaded files are erased for good. Completed orders stay in the books, anonymised.' },
    'acc.deleteWarn':  { uz: 'Bu amalni bekor qilib bo‘lmaydi. Tasdiqlash uchun yana bosing.', ru: 'Это действие нельзя отменить. Нажмите ещё раз, чтобы подтвердить.', en: 'This cannot be undone. Press again to confirm.' },
    'acc.deleteBtn':   { uz: 'Akkauntni o‘chirish', ru: 'Удалить аккаунт', en: 'Delete account' },
    'acc.deleteConfirm': { uz: 'Ha, butunlay o‘chirilsin', ru: 'Да, удалить навсегда', en: 'Yes, delete permanently' },
    'acc.myProfile':   { uz: 'Mening profilim', ru: 'Мой профиль', en: 'My profile' },
    'acc.statOrders':  { uz: 'Buyurtmalar', ru: 'Заказов',    en: 'Orders' },
    'acc.statSpent':   { uz: 'Sarflangan', ru: 'Потрачено',   en: 'Spent' },
    'acc.statSince':   { uz: 'Biz bilan',  ru: 'С нами с',    en: 'Member since' },
    'acc.defaultAddr': { uz: 'Yetkazib berish manzili (asosiy)', ru: 'Адрес доставки (по умолчанию)', en: 'Delivery address (default)' },
    'acc.enterAddr':   { uz: 'Manzilni kiriting', ru: 'Введите адрес', en: 'Enter address' },
    'acc.find':        { uz: 'Topish',     ru: 'Найти',       en: 'Find' },
    'acc.pickOnMap':   { uz: 'Xaritada tanlash', ru: 'Выбрать на карте', en: 'Pick on map' },
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
    'reset.toLogin':   { uz: 'Kirish', ru: 'Войти', en: 'Sign in' },

    // ===== LOOM Lab (index.html band, lab.html, configurator tile) =====
    'lab.t1':         { uz: 'So‘z bilan tasvirlang.', ru: 'Опишите словами.', en: 'Describe it in words.' },
    'lab.t2':         { uz: 'Kiyib yuring.', ru: 'Наденьте на себя.', en: 'Then wear it.' },
    'lab.lead':       { uz: 'LOOM Lab iborani tayyor bosmaga aylantiradi: rasm chizadi, fonni olib tashlaydi va uni bosma maydoniga moslaydi — to‘g‘ridan-to‘g‘ri konstruktorda.', ru: 'LOOM Lab превращает фразу в готовый принт: рисует картинку, убирает фон и подгоняет её под область печати — прямо в конструкторе.', en: 'LOOM Lab turns a sentence into a finished print: it draws the image, removes the background and fits it to the print area — right inside the configurator.' },
    'lab.f1':         { uz: 'Matnli tavsifdan bosma', ru: 'Принт из текстового описания', en: 'A print from a written description' },
    'lab.f2':         { uz: 'Fonni avtomatik olib tashlash', ru: 'Автоматическое удаление фона', en: 'Automatic background removal' },
    'lab.f3':         { uz: 'Bosmaga tayyor o‘lcham', ru: 'Готовое к печати разрешение', en: 'Print-ready resolution' },
    'lab.soon':       { uz: 'Tez orada', ru: 'Скоро', en: 'Coming soon' },
    'lab.more':       { uz: 'Bu nima bo‘ladi →', ru: 'Что это будет →', en: 'What it will be →' },
    'lab.p1':         { uz: 'ingichka chiziqlarda Toshkent xaritasi', ru: 'карта Ташкента тонкими линиями', en: 'a map of Tashkent in thin lines' },
    'lab.p2':         { uz: 'so‘zana uslubidagi anor naqshi', ru: 'гранатовый узор в стиле сюзане', en: 'a pomegranate pattern in suzani style' },
    'lab.p3':         { uz: 'quyosh botishida Chimyon tog‘lari, minimalizm', ru: 'горы Чимгана на закате, минимализм', en: 'the Chimgan mountains at sunset, minimal' },
    'lab.pageLead':   { uz: 'LOOM Lab — konstruktor ichidagi bosma generatori. Siz g‘oyani oddiy ibora bilan tasvirlaysiz, Lab uni chizadi, fonni kesadi va bosmaga kerakli o‘lchamdagi faylni beradi. Bu qismni ichkarida yig‘ib, sinab ko‘rdik — endi uni hammaga ochish qoldi.', ru: 'LOOM Lab — это генератор принтов внутри конструктора. Вы описываете идею обычной фразой, Lab рисует её, вырезает фон и отдаёт файл в том разрешении, которое нужно печати. Мы уже собрали и протестировали эту часть внутри — осталось открыть её всем.', en: 'LOOM Lab is a print generator inside the configurator. You describe the idea in a plain sentence, Lab draws it, cuts out the background and hands over a file at the resolution printing needs. We have built and tested this part internally — all that is left is opening it to everyone.' },
    'lab.noDate':     { uz: 'Sanani shu yerda va Telegramda e’lon qilamiz', ru: 'Дату объявим здесь и в Telegram', en: 'We will announce the date here and on Telegram' },
    'lab.howLabel':   { uz: 'Bu qanday ishlaydi', ru: 'Как это будет работать', en: 'How it will work' },
    'lab.s1t':        { uz: 'Bosmani tasvirlang', ru: 'Опишите принт', en: 'Describe the print' },
    'lab.s1b':        { uz: 'Rus, o‘zbek yoki ingliz tilida bitta ibora bilan. «Ingichka chiziqlarda Toshkent xaritasi» — shuning o‘zi yetarli.', ru: 'Одной фразой на русском, узбекском или английском. «Карта Ташкента тонкими линиями» — этого достаточно.', en: 'One sentence in Russian, Uzbek or English. “A map of Tashkent in thin lines” is enough.' },
    'lab.s2t':        { uz: 'Variantni tanlang', ru: 'Выберите вариант', en: 'Pick a version' },
    'lab.s2b':        { uz: 'Lab bir nechta variantni ko‘rsatadi. Fon avtomatik olinadi, shuning uchun bosma har qanday rangdagi matoga darhol yotadi.', ru: 'Lab покажет несколько версий. Фон снимается автоматически, поэтому принт сразу ложится на ткань любого цвета.', en: 'Lab shows a few versions. The background is removed automatically, so the print sits on fabric of any colour straight away.' },
    'lab.s3t':        { uz: 'Kiyib ko‘ring va buyurtma bering', ru: 'Примерьте и закажите', en: 'Try it on and order' },
    'lab.s3b':        { uz: 'Tayyor rasm konstruktorda oddiy qatlam sifatida paydo bo‘ladi: suring, o‘lchamini o‘zgartiring, 3D’da ko‘ring va buyurtma bering.', ru: 'Готовая картинка появляется в конструкторе как обычный слой: двигайте, меняйте размер, смотрите в 3D и заказывайте.', en: 'The finished image appears in the configurator as an ordinary layer: move it, resize it, view it in 3D and order.' },
    'lab.statusLabel':{ uz: 'Nima tayyor', ru: 'Что уже готово', en: 'What is ready' },
    'lab.st1':        { uz: 'Rasm generatsiyasi va modellarni solishtirish', ru: 'Генерация изображений и сравнение моделей', en: 'Image generation and model comparison' },
    'lab.st2':        { uz: 'Fonni avtomatik olib tashlash', ru: 'Автоматическое удаление фона', en: 'Automatic background removal' },
    'lab.st3':        { uz: 'Foydalanuvchi bo‘yicha limit va narx', ru: 'Лимиты и стоимость на пользователя', en: 'Per-customer limits and cost' },
    'lab.st4':        { uz: 'Bosmadan oldin tekshiruv', ru: 'Проверка сгенерированного перед печатью', en: 'Review of generated art before printing' },
    'lab.st5':        { uz: 'Konstruktordagi tugma', ru: 'Кнопка в конструкторе', en: 'The button in the configurator' },
    'lab.stDone':     { uz: 'Tayyor', ru: 'Готово', en: 'Done' },
    'lab.stWip':      { uz: 'Ishlanmoqda', ru: 'В работе', en: 'In progress' },
    'lab.stNext':     { uz: 'Keyingi qadam', ru: 'Следующий шаг', en: 'Next up' },
    'lab.meanwhile':  { uz: 'Ayni paytda — bosmani qo‘lda yig‘ing yoki dizaynerlarimizdan tayyorini oling. Lab’da paydo bo‘ladigan hamma narsa xuddi shu konstruktorda ishlaydi.', ru: 'А пока — соберите принт руками или возьмите готовый у наших дизайнеров. Всё, что появится в Lab, будет работать в том же конструкторе.', en: 'In the meantime, build a print by hand or take a ready one from our designers. Everything Lab adds will work in the same configurator.' },
    'lab.toConfig':   { uz: 'Konstruktorga', ru: 'В конструктор', en: 'Open the configurator' },
    'lab.toMarket':   { uz: 'Marketga', ru: 'В маркет', en: 'Open the market' },
    'lab.tileTitle':  { uz: 'LOOM Lab bilan o‘ylab topish', ru: 'Придумать с LOOM Lab', en: 'Invent it with LOOM Lab' },
    'lab.tileSub':    { uz: 'Bosmani so‘z bilan tasvirlang — Lab chizib beradi', ru: 'Опишите принт словами — Lab нарисует его', en: 'Describe the print — Lab will draw it' },
    'lab.sheetTitle': { uz: 'LOOM Lab', ru: 'LOOM Lab', en: 'LOOM Lab' },
    'lab.sheetLead':  { uz: 'Bosmani oddiy ibora bilan tasvirlang — Lab uni chizadi, fonni oladi va futbolkaga bosma o‘lchamida joylaydi.', ru: 'Опишите принт обычной фразой — Lab нарисует его, уберёт фон и положит на футболку в печатном разрешении.', en: 'Describe the print in a plain sentence — Lab draws it, removes the background and puts it on the shirt at print resolution.' },
    'cfg.close':      { uz: 'Yopish', ru: 'Закрыть', en: 'Close' },

    // ===== 404 =====
    'e404.t1':        { uz: 'Sahifa', ru: 'Страница', en: 'This page' },
    'e404.t2':        { uz: 'so‘kilib ketdi.', ru: 'распустилась.', en: 'came apart.' },
    'e404.lead':      { uz: 'Bunday sahifa yo‘q — u olib tashlangan bo‘lishi yoki havolada xato bo‘lishi mumkin. Konstruktor esa joyida: o‘zingiznikini yig‘ing.', ru: 'Такой страницы нет — её могли убрать, или в ссылке опечатка. Зато конструктор на месте: соберите что-нибудь своё.', en: 'There is no page at this address — it may have been removed, or the link has a typo. The configurator is still where you left it.' },
    'e404.code':      { uz: 'Xato 404', ru: 'Ошибка 404', en: 'Error 404' },
    'e404.caption':   { uz: 'Bosilmagan yagona narsa', ru: 'Единственное, что мы не напечатали', en: 'The one thing we never printed' },

    // ===== Marketplace (market.html, designer.html) =====
    'mk.heroT1':      { uz: 'Odamlar', ru: 'Дизайны,', en: 'Designs made' },
    'mk.heroT2':      { uz: 'o‘ylab topgan dizaynlar.', ru: 'придуманные людьми.', en: 'by people.' },
    'mk.heroLead':    { uz: 'Mustaqil dizaynerlarning ishlari. Bosmani tanlang — u konstruktorda ochiladi, muallif esa har bir sotuvdan o‘z ulushini oladi.', ru: 'Работы независимых дизайнеров. Выберите принт — он откроется в конструкторе, а автор получит свою долю с каждой проданной вещи.', en: 'Work by independent designers. Pick a print — it opens in the configurator, and its author earns a share of every sale.' },
    'mk.becomeCta':   { uz: 'Dizayner bo‘lish →', ru: 'Стать дизайнером →', en: 'Become a designer →' },
    'mk.try':         { uz: 'Kiyib ko‘rish', ru: 'Примерить', en: 'Try it on' },
    'mk.sold':        { uz: 'Sotilgan', ru: 'Продано', en: 'Sold' },
    'mk.works':       { uz: 'ta ish', ru: 'работ', en: 'works' },
    'mk.worksNone':   { uz: 'hozircha bo‘sh', ru: 'пока пусто', en: 'nothing yet' },
    'mk.empty':       { uz: 'Hozircha bo‘sh. Birinchi ishlar tez orada paydo bo‘ladi — yoki o‘zingiznikini yuklang.', ru: 'Здесь пока пусто. Первые работы появятся совсем скоро — или загрузите свою.', en: 'Nothing here yet. The first works are coming soon — or upload your own.' },
    'mk.failed':      { uz: 'Yuklab bo‘lmadi. Sahifani yangilang.', ru: 'Не удалось загрузить. Обновите страницу.', en: 'Could not load. Please refresh.' },
    'mk.loadMore':    { uz: 'Yana ko‘rsatish', ru: 'Показать ещё', en: 'Show more' },
    'mk.backToMarket':{ uz: '← Marketga', ru: '← В маркет', en: '← Back to market' },
    // ----- Designer directory (designers.html) -----
    'dir.title1':   { uz: 'Ishning ortidagi', ru: 'Люди, которые', en: 'The people' },
    'dir.title2':   { uz: 'odamlar.', ru: 'придумывают принты.', en: 'behind the prints.' },
    'dir.lead':     { uz: 'LOOM marketida ishlari tasdiqlangan mustaqil dizaynerlar. Har biriga kirib, uning barcha ishlarini ko‘ring.', ru: 'Независимые дизайнеры, чьи работы прошли проверку и продаются в маркете LOOM. Загляните к любому — увидите все его принты.', en: 'Independent designers whose work passed review and sells in the LOOM market. Open any of them to see everything they have made.' },
    'dir.works':    { uz: 'ta ish', ru: 'работ', en: 'works' },
    'dir.sold':     { uz: 'sotilgan', ru: 'продано', en: 'sold' },
    'dir.none':     { uz: 'dizaynerlar yo‘q', ru: 'пока никого', en: 'nobody yet' },
    'dir.count':    { uz: 'ta dizayner', ru: 'дизайнеров', en: 'designers' },
    'dir.view':     { uz: 'Ishlarni ko‘rish', ru: 'Смотреть работы', en: 'See their work' },
    'dir.failed':   { uz: 'Yuklab bo‘lmadi. Sahifani yangilang.', ru: 'Не удалось загрузить. Обновите страницу.', en: 'Could not load. Please refresh.' },
    'nav.designers':{ uz: 'Dizaynerlar', ru: 'Дизайнеры', en: 'Designers' },

    // ----- Market: open call shown when there are no works yet -----
    'mk.openEyebrow': { uz: 'Ochiq chaqiruv', ru: 'Открытый набор', en: 'Open call' },
    'mk.openT1':      { uz: 'Hozircha bo‘sh.', ru: 'Здесь пока пусто.', en: 'Nothing here yet.' },
    'mk.openT2':      { uz: 'Birinchisi siz bo‘lishingiz mumkin.', ru: 'Первым можете стать вы.', en: 'You could be the first.' },
    'mk.openLead':    { uz: 'Market dizaynerlar uchun ochiq. Ishingizni yuklang — biz uni tekshiramiz, shu yerda ko‘rsatamiz, va har bir sotilgan buyum uchun o‘z ustamangizni olasiz.', ru: 'Маркет открыт для дизайнеров. Загрузите работу — мы проверим её, покажем здесь, и вы будете получать свою наценку с каждой проданной вещи.', en: 'The market is open to designers. Upload a work — we review it, show it here, and you take your markup on every item sold.' },
    'mk.openSlot':    { uz: 'Sizning printingiz shu yerda', ru: 'Ваш принт здесь', en: 'Your print goes here' },
    'mk.openHow':     { uz: 'Bu qanday ishlaydi', ru: 'Как это работает', en: 'How it works' },

    'mk.designer':    { uz: 'Dizayner', ru: 'Дизайнер', en: 'Designer' },
    'mk.notFound':    { uz: 'Dizayner topilmadi', ru: 'Дизайнер не найден', en: 'Designer not found' },
    'mk.applied':     { uz: 'Dizayn qo‘shildi', ru: 'Дизайн добавлен', en: 'Design added' },
    'mk.applyFailed': { uz: 'Ishni yuklab bo‘lmadi', ru: 'Не удалось загрузить работу', en: 'Could not load that work' },
    'common.free':    { uz: 'Bepul', ru: 'Бесплатно', en: 'Free' },

    // ===== Designer studio (account.html → Дизайнер) =====
    'dz.becomeTitle': { uz: 'LOOM dizayneri bo‘ling', ru: 'Станьте дизайнером LOOM', en: 'Become a LOOM designer' },
    'dz.becomeLead':  { uz: 'O‘z grafikangizni yuklang. Biz uni tekshiramiz, marketda ko‘rsatamiz — va siz har bir sotilgan buyumdan o‘z ustamangizni olasiz.', ru: 'Загрузите свою графику. Мы проверим её, покажем в маркете — и вы получаете свою наценку с каждой проданной вещи.', en: 'Upload your graphics. We review them, put them in the market — and you earn your markup on every item sold.' },
    'dz.step1':       { uz: 'Nik o‘ylab toping — ishlaringizni xaridorlar shu nom ostida ko‘radi.', ru: 'Придумайте ник — под ним ваши работы увидят покупатели.', en: 'Pick a handle — buyers will see your work under it.' },
    'dz.step2':       { uz: 'Faylni yuklang va o‘z ustamangizni belgilang.', ru: 'Загрузите файл и назначьте свою наценку.', en: 'Upload the file and set your markup.' },
    'dz.step3':       { uz: 'Tekshiruvdan so‘ng ish marketda paydo bo‘ladi, sotuvlar esa — shu yerda.', ru: 'После проверки работа появится в маркете, а продажи — здесь.', en: 'Once approved it appears in the market, and the sales appear here.' },
    'dz.handle':      { uz: 'Dizayner nomi', ru: 'Ник дизайнера', en: 'Designer handle' },
    'dz.handleHint':  { uz: '3–24 belgi: lotin harflari, raqamlar, nuqta yoki pastki chiziq.', ru: '3–24 символа: латиница, цифры, точка или подчёркивание.', en: '3–24 characters: latin letters, digits, dot or underscore.' },
    'dz.handleBad':   { uz: 'Nik: 3–24 belgi, lotin harflari, raqamlar, nuqta yoki pastki chiziq.', ru: 'Ник: 3–24 символа, латиница, цифры, точка или подчёркивание.', en: 'Handle: 3–24 characters, latin letters, digits, dot or underscore.' },
    'dz.bio':         { uz: 'O‘zingiz haqingizda', ru: 'О себе', en: 'About you' },
    'dz.bioPh':       { uz: 'O‘zingiz va uslubingiz haqida bir necha so‘z', ru: 'Пара слов о вас и вашем стиле', en: 'A line or two about you and your style' },
    'dz.apply':       { uz: 'Dizayner bo‘lish', ru: 'Стать дизайнером', en: 'Become a designer' },
    'dz.applied':     { uz: 'Tayyor! Endi siz LOOM dizaynerisiz.', ru: 'Готово! Теперь вы дизайнер LOOM.', en: 'Done — you are a LOOM designer now.' },
    'dz.saveProfile': { uz: 'Saqlash', ru: 'Сохранить', en: 'Save' },
    'dz.editProfile': { uz: 'O‘zgartirish', ru: 'Изменить', en: 'Edit' },
    'dz.publicPage':  { uz: 'Mening sahifam →', ru: 'Моя страница →', en: 'My page →' },
    'dz.studioTitle': { uz: 'Dizayner kabineti', ru: 'Кабинет дизайнера', en: 'Designer studio' },
    'dz.statWorks':   { uz: 'Ishlar', ru: 'Работ', en: 'Works' },
    'dz.statSold':    { uz: 'Sotilgan', ru: 'Продано', en: 'Sold' },
    'dz.statEarned':  { uz: 'Ishlangan', ru: 'Заработано', en: 'Earned' },
    'dz.commission':  { uz: 'Har bir sotuvdan LOOM ustamangizning {pct}% ini ushlab qoladi, qolgani — sizniki.', ru: 'С каждой продажи LOOM удерживает {pct}% вашей наценки, остальное — ваше.', en: 'LOOM keeps {pct}% of your markup on each sale; the rest is yours.' },
    'dz.uploadTitle': { uz: 'Ish yuklash', ru: 'Загрузить работу', en: 'Upload a work' },
    'dz.dropLabel':   { uz: 'Bosing yoki faylni tashlang', ru: 'Нажмите или перетащите файл', en: 'Click, or drop a file here' },
    'dz.dropHint':    { uz: 'Shaffof fonli PNG · uzun tomoni kamida 1500 px', ru: 'PNG с прозрачным фоном · минимум 1500 px по длинной стороне', en: 'PNG with a transparent background · at least 1500 px on the long edge' },
    'dz.workTitle':   { uz: 'Nomi', ru: 'Название', en: 'Title' },
    'dz.workTitlePh': { uz: 'Tungi Toshkent', ru: 'Ночной Ташкент', en: 'Tashkent at night' },
    'dz.markup':      { uz: 'Sizning ustamangiz, so‘m', ru: 'Ваша наценка, сум', en: 'Your markup, UZS' },
    'dz.markupShort': { uz: 'Ustama', ru: 'Наценка', en: 'Markup' },
    'dz.tags':        { uz: 'Teglar', ru: 'Теги', en: 'Tags' },
    'dz.tagsPh':      { uz: 'minimalizm, shahar, chiziqlar', ru: 'минимализм, город, линии', en: 'minimal, city, lines' },
    'dz.submitWork':  { uz: 'Tekshiruvga yuborish', ru: 'Отправить на проверку', en: 'Submit for review' },
    'dz.submitted':   { uz: 'Tekshiruvga yuborildi. Odatda bir kundan ko‘p vaqt olmaydi.', ru: 'Отправлено на проверку. Обычно это занимает не больше дня.', en: 'Sent for review. It usually takes less than a day.' },
    'dz.uploading':   { uz: 'Yuklanmoqda…', ru: 'Загружаем…', en: 'Uploading…' },
    'dz.needFile':    { uz: 'Avval faylni tanlang.', ru: 'Сначала выберите файл.', en: 'Choose a file first.' },
    'dz.needTitle':   { uz: 'Ish nomini kiriting.', ru: 'Укажите название работы.', en: 'Give the work a title.' },
    'dz.notImage':    { uz: 'Bu rasmga o‘xshamaydi.', ru: 'Это не похоже на картинку.', en: 'That does not look like an image.' },
    'dz.tooSmall':    { uz: 'Uzun tomoni kamida {n} px bo‘lsin — sizda {w}×{h}.', ru: 'Минимум {n} px по длинной стороне — у вас {w}×{h}.', en: 'At least {n} px on the long edge — yours is {w}×{h}.' },
    'dz.myWorks':     { uz: 'Mening ishlarim', ru: 'Мои работы', en: 'My works' },
    'dz.noWorks':     { uz: 'Siz hali hech narsa yuklamadingiz. Yuqoridagi shakldan boshlang.', ru: 'Вы пока ничего не загрузили. Начните с формы выше.', en: 'You have not uploaded anything yet. Start with the form above.' },
    'dz.noPublicWorks': { uz: 'Bu dizaynerda hali tasdiqlangan ishlar yo‘q.', ru: 'У этого дизайнера пока нет одобренных работ.', en: 'This designer has no approved works yet.' },
    'dz.soldTimes':   { uz: 'Sotilgan: ', ru: 'Продано: ', en: 'Sold: ' },

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

  /**
   * The display name of a catalogue product in the current language.
   *
   * Products carry name_ru (required), name_uz and name_en (both optional,
   * migration 0020). Everything customer-facing has to go through here rather
   * than reading name_ru directly — that is why a customer browsing in Uzbek
   * used to see Russian product names on an otherwise fully translated page.
   *
   * Falls back deliberately: asked language → Russian → English → slug. A
   * half-translated catalogue renders correctly instead of showing blanks,
   * which is what lets the names be filled in from admin over time.
   */
  function productName(p, lang) {
    if (!p) return '';
    lang = lang || getLang();
    var key = lang === 'uz' ? 'name_uz' : lang === 'en' ? 'name_en' : 'name_ru';
    var pick = p[key];
    if (typeof pick === 'string' && pick.trim()) return pick.trim();
    return (p.name_ru || p.name_en || p.name_uz || p.slug || '').trim();
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

  /* ── Plurals ──────────────────────────────────────────────────
     Russian agrees a noun with the number in three forms, and the site
     was picking the genitive plural for everything: "3 дизайнеров",
     "2 работ". Uzbek does not pluralise after a numeral at all (one
     form), English has two.

       ru: 1, 21, 101      -> one     работа   дизайнер
           2-4, 22-24      -> few     работы   дизайнера
           0, 5-20, 11-14  -> many    работ    дизайнеров

     Forms are ordered [one, few, many] for ru, [one, other] for en and
     [any] for uz. */
  const PLURALS = {
    'plural.works':     { uz: ['ta ish'],       ru: ['работа', 'работы', 'работ'],          en: ['work', 'works'] },
    'plural.designers': { uz: ['ta dizayner'],  ru: ['дизайнер', 'дизайнера', 'дизайнеров'], en: ['designer', 'designers'] }
  };

  function pluralIndex(lang, n) {
    const abs = Math.abs(Math.floor(Number(n) || 0));
    if (lang === 'uz') return 0;
    if (lang === 'en') return abs === 1 ? 0 : 1;
    /* ru */
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return 0;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
    return 2;
  }

  /** The correct noun form for `n` — the number itself is the caller's. */
  function plural(n, key) {
    const lang = getLang();
    const entry = PLURALS[key];
    if (!entry) return '';
    const forms = entry[lang] || entry[DEFAULT] || [];
    return forms[Math.min(pluralIndex(lang, n), forms.length - 1)] || forms[0] || '';
  }

  window.LOOM_I18N = {
    getLang: getLang, setLang: setLang, t: t, apply: apply, plural: plural,
    applyTo: applyTo, formatPrice: formatPrice, initSwitchers: initSwitchers,
    productName: productName,
    LANGS: LANGS
  };
})();

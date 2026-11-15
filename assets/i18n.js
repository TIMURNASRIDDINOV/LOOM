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

  // LOOM-199: links in the CC BY 4.0 credit of the bundled tee model
  // (assets/models/t_shirt*.glb). Names and URLs come from its asset.extras.
  function creditLink(href, text) {
    return '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
  }
  const CR_TITLE  = creditLink('https://sketchfab.com/3d-models/t-shirt-c1a3e5eb9b5445f4b7d4be82f1127eba', 'T Shirt');
  const CR_AUTHOR = creditLink('https://sketchfab.com/funlab117', 'funlab117');
  const CR_LICENSE = creditLink('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0');

  // ── Dictionary ────────────────────────────────────────────────
  const DICT = {
    'co.priceChanged': { uz: 'Narxlar o‘zgardi. Yangi summani tekshirib, buyurtmani qayta tasdiqlang.', ru: 'Цены изменились. Проверьте новую сумму и подтвердите заказ ещё раз.', en: 'Prices changed. Review the new total and place the order again.' },
    "artwork_price_changed": {"uz": "Dizayn narxi o‘zgardi. Yangi narxni ko‘rish uchun mahsulotni savatchadan o‘chirib, qayta qo‘shing.", "ru": "Цена дизайна изменилась. Удалите эту вещь из корзины и добавьте её заново, чтобы увидеть новую цену.", "en": "This design’s price changed. Remove this item from your cart and add it again to see the new price."},
    "artwork_price_changed_title": {"uz": "«{title}» dizayni narxi o‘zgardi. Yangi narxni ko‘rish uchun shu dizayndagi mahsulotni savatchadan o‘chirib, qayta qo‘shing.", "ru": "Цена дизайна «{title}» изменилась. Удалите вещь с этим дизайном из корзины и добавьте её заново, чтобы увидеть новую цену.", "en": "The price of the design “{title}” changed. Remove the item with this design from your cart and add it again to see the new price."},
    "cat.label": { uz: "Kategoriya", ru: "Категория", en: "Category" },
    "cat.choose": { uz: "Dizayningizga mos kategoriyani tanlang", ru: "Выберите категорию для дизайна", en: "Choose the category that fits your design" },
    "cat.all": { uz: "Barcha kategoriyalar", ru: "Все категории", en: "All categories" },
    "cat.empty": { uz: "Bu kategoriyada hali dizaynlar yo‘q.", ru: "В этой категории пока нет дизайнов.", en: "No designs in this category yet." },
    "cat.failed": { uz: "Kategoriyalarni yuklab bo‘lmadi. Qayta urinib ko‘ring.", ru: "Не удалось загрузить категории. Попробуйте снова.", en: "Could not load categories. Please retry." },
    "cat.retry": { uz: "Qayta urinish", ru: "Повторить", en: "Retry" },
    "artwork_title": { uz: "Nom 1–80 belgidan iborat bo‘lishi kerak.", ru: "Название должно содержать от 1 до 80 символов.", en: "Title must contain 1–80 characters." },
    "artwork_markup": { uz: "Ustama 0 dan 200 000 so‘mgacha butun son bo‘lishi kerak.", ru: "Наценка — целое число от 0 до 200 000 сум.", en: "Markup must be a whole number from 0 to 200,000 UZS." },
    "artwork_tags": { uz: "Teglar 200 belgidan oshmasligi kerak.", ru: "Теги — не более 200 символов.", en: "Tags must be at most 200 characters." },
    "artwork_category": { uz: "Amaldagi kategoriyani tanlang.", ru: "Выберите действующую категорию.", en: "Choose an active category." },

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





    // ===== Footer =====
    'footer.contact':  { uz: 'Aloqa',  ru: 'Контакты',  en: 'Contact' },
    'footer.location': { uz: 'Toshkent, O‘zbekiston', ru: 'Ташкент, Узбекистан', en: 'Tashkent, Uzbekistan' },
    'footer.privacy':  { uz: 'Maxfiylik va cookie', ru: 'Конфиденциальность и cookie', en: 'Privacy and cookies' },

    // ===== Analytics consent banner (assets/analytics.js, LOOM-283) =====
    'consent.text':    { uz: 'Sayt qanday ishlatilishini tushunish uchun Google Analytics, Microsoft Clarity va Yandex Metrika’dan foydalanamiz. Ular faqat roziligingiz bilan yoqiladi.', ru: 'Мы используем Google Analytics, Microsoft Clarity и Яндекс Метрику, чтобы понимать, как люди пользуются сайтом. Они включаются только с вашего согласия.', en: 'We use Google Analytics, Microsoft Clarity and Yandex Metrica to understand how people use the site. They run only if you agree.' },
    'consent.accept':  { uz: 'Roziman', ru: 'Принять', en: 'Accept' },
    'consent.decline': { uz: 'Rad etish', ru: 'Отказаться', en: 'Decline' },
    'consent.more':    { uz: 'Batafsil', ru: 'Подробнее', en: 'Learn more' },
    'footer.navTitle':    { uz: 'Sahifalar', ru: 'Навигация', en: 'Navigate' },
    'footer.designersTitle': { uz: 'Dizaynerlarga', ru: 'Дизайнерам', en: 'For designers' },
    'footer.becomeDesigner': { uz: 'Dizayner bo‘lish', ru: 'Стать дизайнером', en: 'Become a designer' },
    'footer.socialTitle': { uz: 'Aloqa',     ru: 'Связь',     en: 'Connect' },


    // ===== Catalog =====
    'catalog.empty':        { uz: 'Katalog bo‘sh.', ru: 'Каталог пуст.', en: 'The catalog is empty.' },
    'catalog.readyBadge':   { uz: 'Tayyor dizayn', ru: 'Готовый дизайн', en: 'Ready design' },

    // ===== Configurator — panel =====
    'cfg.eyebrow':      { uz: 'Konstruktor', ru: 'Конфигуратор', en: 'Configurator' },
    'cfg.panelProduct': { uz: 'O‘z dizayningizni yarating', ru: 'Создайте свой дизайн', en: 'Create your design' },
    'cfg.currency':     { uz: 'so‘m', ru: 'сум', en: 'UZS' },
    'cfg.tabColor':     { uz: 'Rang',   ru: 'Цвет',   en: 'Color' },
    'cfg.tabDesign':    { uz: 'Dizayn', ru: 'Дизайн', en: 'Design' },
    'cfg.tabSummary':   { uz: 'Yakun',  ru: 'Итог',   en: 'Summary' },
    'cfg.shirtColor':   { uz: 'Rang', ru: 'Цвет', en: 'Color' },
    'cfg.size':         { uz: 'O‘lcham', ru: 'Размер', en: 'Size' },
    'cfg.layerText':    { uz: 'Matn',     ru: 'Текст',    en: 'Text' },
    'cfg.layerLogo':    { uz: 'Logotip',  ru: 'Логотип',  en: 'Logo' },
    'cfg.layers':       { uz: 'Qatlamlar', ru: 'Слои', en: 'Layers' },
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
    'cfg.cm':           { uz: 'sm', ru: 'см', en: 'cm' },
    'cfg.zoomPrint':    { uz: 'Chop etish maydonini yaqinlashtirish', ru: 'Приблизить область печати', en: 'Zoom to the print area' },
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
    'cfg.step1Lead':    { uz: 'Rasm yuklang yoki matn yozing — kiyimda darhol ko‘rinadi.', ru: 'Загрузите картинку или напишите текст — вы сразу увидите её на одежде.', en: 'Upload a picture or write some text — you will see it on the garment straight away.' },
    'cfg.step2Title':   { uz: 'Rang va o‘lcham', ru: 'Цвет и размер', en: 'Colour and size' },
    'cfg.step2Lead':    { uz: 'O‘lchamingizni tanlang, so‘ng mato rangini almashtirish uchun kvadratchani bosing.', ru: 'Выберите размер, затем нажмите на квадрат, чтобы сменить цвет ткани.', en: 'Pick your size, then tap a square to change the fabric colour.' },
    'cfg.sizeRequired': { uz: 'Avval o‘lchamni tanlang', ru: 'Сначала выберите размер', en: 'Choose a size first' },
    'cfg.sizeChoice':   { uz: 'O‘lchamni tanlash', ru: 'Выбор размера', en: 'Choose a size' },
    'cfg.colorChoice':  { uz: 'Rangni tanlash', ru: 'Выбор цвета', en: 'Choose a colour' },
    'cfg.step3Title':   { uz: 'Tekshiring va buyurtma bering', ru: 'Проверьте и закажите', en: 'Check it and order' },
    'cfg.step3Lead':    { uz: 'Hammasi joyidami? Pastdagi katta tugmani bosing — tikib, yetkazib beramiz.', ru: 'Всё верно? Нажмите большую кнопку внизу — мы сошьём и привезём.', en: 'All good? Press the big button below — we will make it and deliver.' },
    'cfg.addImageSub':  { uz: 'Rasm, logotip yoki chizma', ru: 'Фото, логотип или рисунок', en: 'A photo, a logo or a drawing' },
    'cfg.addTextSub':   { uz: 'Ism, yozuv yoki tilak', ru: 'Имя, надпись или пожелание', en: 'A name, a slogan or a wish' },
    'cfg.nextColor':    { uz: 'Keyingisi: rang va o‘lcham', ru: 'Дальше: цвет и размер', en: 'Next: colour and size' },
    'cfg.nextOrder':    { uz: 'Keyingisi: buyurtma', ru: 'Дальше: заказ', en: 'Next: your order' },
    'cfg.nextColorShort': { uz: 'Keyin: rang', ru: 'Дальше: цвет', en: 'Next: colour' },
    'cfg.nextOrderShort': { uz: 'Keyin: buyurtma', ru: 'Дальше: заказ', en: 'Next: order' },
    'cfg.nextDesign':   { uz: 'Keyin: dizayn', ru: 'Дальше: дизайн', en: 'Next: design' },
    'cfg.nextPlace':    { uz: 'Keyin: joylash', ru: 'К размещению', en: 'Next: placement' },
    'cfg.addToBag':     { uz: 'Savatga qo‘shish', ru: 'Добавить в корзину', en: 'Add to bag' },
    // LOOM-307: the Atelye phone shell. ru and en are drafts for Content.
    'cfg.back':         { uz: 'Orqaga', ru: 'Назад', en: 'Back' },
    'cfg.noSize':       { uz: 'o‘lcham yo‘q', ru: 'размер не выбран', en: 'no size' },
    'cfg.moreActions':  { uz: 'Yana', ru: 'Ещё', en: 'More' },
    // LOOM-308: the Atelye tool rail. ru and en are drafts for Content.
    'cfg.tools':        { uz: 'Asboblar', ru: 'Инструменты', en: 'Tools' },
    'cfg.railImage':    { uz: 'Rasm', ru: 'Картинка', en: 'Image' },
    // LOOM-309: the Atelye context strip. ru and en are drafts for Content.
    'cfg.pickSize':     { uz: 'O‘lchamni tanlang', ru: 'Выберите размер', en: 'Choose a size' },
    'cfg.sizeN':        { uz: 'O‘lcham {size}', ru: 'Размер {size}', en: 'Size {size}' },
    'cfg.edit':         { uz: 'Tahrirlash', ru: 'Изменить', en: 'Edit' },
    'cfg.rotate15':     { uz: 'Burish, 15 daraja', ru: 'Повернуть на 15 градусов', en: 'Rotate 15 degrees' },
    'cfg.resize':       { uz: 'O‘lchamni o‘zgartirish', ru: 'Изменить размер', en: 'Resize' },
    'cfg.editText':     { uz: 'Matnni tahrirlash', ru: 'Изменить текст', en: 'Edit text' },
    'cfg.done':         { uz: 'Tayyor', ru: 'Готово', en: 'Done' },
    'cfg.bold':         { uz: 'Qalin', ru: 'Жирный', en: 'Bold' },
    'cfg.italic':       { uz: 'Kursiv', ru: 'Курсив', en: 'Italic' },
    'cfg.layerImageAria': { uz: 'Rasm qatlami, {w} × {h} sm', ru: 'Слой с картинкой, {w} × {h} см', en: 'Image layer, {w} × {h} cm' },
    'cfg.layerTextAria': { uz: 'Matn qatlami: {text}', ru: 'Текстовый слой: {text}', en: 'Text layer: {text}' },
    // LOOM-311: the Atelye bottom sheets. ru and en are drafts for Content.
    'cfg.sheetResize':  { uz: 'Varaq balandligini o‘zgartirish', ru: 'Изменить высоту панели', en: 'Resize the sheet' },
    'cfg.noPrint':      { uz: 'bosmasiz', ru: 'без принта', en: 'no print' },
    'cfg.sizeTable':    { uz: 'O‘lchamlar jadvali', ru: 'Таблица размеров', en: 'Size table' },
    'cfg.zoomIn':       { uz: 'Yaqinlashtirish', ru: 'Приблизить', en: 'Zoom in' },
    'cfg.savePngShort': { uz: 'PNG saqlash', ru: 'Сохранить PNG', en: 'Save PNG' },
    'cfg.faceFront':    { uz: 'Old tomon', ru: 'Перед', en: 'Front side' },
    'cfg.faceBack':     { uz: 'Orqa tomon', ru: 'Спина', en: 'Back side' },
    // LOOM-295: the phone's step 3 (Joylash). ru and en are drafts for Content.
    'cfg.more':         { uz: 'Ko‘proq', ru: 'Ещё', en: 'More' },
    'cfg.presetS':      { uz: 'Kichik 10 sm', ru: 'Малый 10 см', en: 'Small 10 cm' },
    'cfg.presetM':      { uz: 'O‘rta 20 sm', ru: 'Средний 20 см', en: 'Medium 20 cm' },
    'cfg.presetL':      { uz: 'Katta 28 sm', ru: 'Крупный 28 см', en: 'Large 28 cm' },
    'cfg.replace':      { uz: 'Almashtirish', ru: 'Заменить', en: 'Replace' },
    'cfg.camSide':      { uz: 'Yon', ru: 'Сбоку', en: 'Side' },
    // LOOM-298: reopens a completed step of the desktop accordion. ru and en are drafts for Content.
    'cfg.change':       { uz: 'O‘zgartirish', ru: 'Изменить', en: 'Change' },
    'cfg.stepDesign':   { uz: 'Dizayn',        ru: 'Дизайн',        en: 'Design' },
    'cfg.stepColorSize':{ uz: 'Rang va o‘lcham', ru: 'Цвет и размер', en: 'Colour & size' },
    'cfg.stepOrder':    { uz: 'Buyurtma',      ru: 'Заказ',         en: 'Order' },
    'cfg.stepGarment':  { uz: 'Kiyim',         ru: 'Одежда',        en: 'Garment' },
    'cfg.stepPlace':    { uz: 'Joylash',       ru: 'Размещение',    en: 'Placement' },
    'cfg.orderBlank':   { uz: 'Bosmasiz buyurtma berish', ru: 'Заказать без принта', en: 'Order without a print' },
    'cfg.deleted':      { uz: 'Qatlam o‘chirildi', ru: 'Слой удалён', en: 'Layer deleted' },
    'cfg.wasReset':     { uz: 'Dizayn tozalandi', ru: 'Дизайн сброшен', en: 'Design was reset' },
    'cfg.layoutSaved':  { uz: 'Maket saqlandi', ru: 'Макет сохранён', en: 'Layout saved' },
    'cfg.layoutLoaded': { uz: 'Maket yuklandi', ru: 'Макет загружен', en: 'Layout loaded' },
    'cfg.layoutNone':   { uz: 'Saqlangan maket yo‘q', ru: 'Сохранённых макетов нет', en: 'No saved layout' },
    'cfg.layoutTooBig': { uz: 'Maket saqlash uchun juda katta', ru: 'Макет слишком большой для сохранения', en: 'Layout too large to save' },
    'cfg.layoutSaveError': { uz: 'Maketni saqlab bo‘lmadi', ru: 'Не удалось сохранить макет', en: 'Could not save layout' },
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
    'cfg.savePng':      { uz: 'Dizaynni PNG sifatida saqlash', ru: 'Сохранить дизайн как PNG', en: 'Save design as PNG' },
    'cfg.savedToast':   { uz: 'Dizayn saqlandi!', ru: 'Дизайн сохранён!', en: 'Design saved!' },
    'cfg.exportPngNeeds3d': { uz: 'PNG saqlash uchun 3D ko‘rinishni oching', ru: 'Откройте 3D-превью, чтобы сохранить PNG', en: 'Open the 3D preview to save a PNG' },
    'cfg.loadingLabel': { uz: '3D ko‘rinish yuklanmoqda', ru: 'Загрузка 3D-превью', en: 'Loading 3D preview' },
    'cfg.loaded3d':     { uz: '3D ko‘rinish tayyor', ru: '3D-превью готово', en: '3D preview ready' },
    'cfg.preview':      { uz: 'Ko‘rib chiqish', ru: 'Предпросмотр', en: 'Preview' },
    'cfg.camFree':      { uz: 'Erkin', ru: 'Свободно', en: 'Free' },
    'cfg.camTurntable': { uz: 'Aylanish', ru: 'Вращение', en: 'Turntable' },
    'cfg.camTurntableZoom': { uz: 'Aylanish + masshtab', ru: 'Вращение + зум', en: 'Turntable + zoom' },
    'cfg.fullscreenEnter': { uz: 'To‘liq ekran', ru: 'Во весь экран', en: 'Full screen' },
    'cfg.viewMode':     { uz: 'Ko‘rinish', ru: 'Вид', en: 'View' },
    // LOOM-199: shown on the stage while the 3D shows the CC BY tee (data-i18n-html)
    'cfg.modelCredit': {
      uz: '“' + CR_TITLE + '” 3D modeli, muallifi ' + CR_AUTHOR + ', ' + CR_LICENSE + ' litsenziyasi asosida. LOOM tomonidan o‘zgartirilgan (veb uchun siqilgan).',
      ru: '3D-модель «' + CR_TITLE + '», автор ' + CR_AUTHOR + ', лицензия ' + CR_LICENSE + '. Изменена LOOM (сжата для веба).',
      en: '3D model “' + CR_TITLE + '” by ' + CR_AUTHOR + ', licensed under ' + CR_LICENSE + '. Modified by LOOM (compressed for the web).'
    },
    'cfg.steps':        { uz: 'Qadamlar', ru: 'Шаги', en: 'Steps' },
    'cfg.designEditor': { uz: 'Dizayn muharriri', ru: 'Редактор дизайна', en: 'Design editor' },
    'cfg.designPanel':  { uz: 'Dizayn paneli', ru: 'Панель дизайна', en: 'Design panel' },
    'cfg.settingsPanel':{ uz: 'Sozlamalar paneli', ru: 'Панель настройки', en: 'Settings panel' },
    'cfg.colorWhite':   { uz: 'Oq',       ru: 'Белый',    en: 'White' },
    'cfg.colorBlack':   { uz: 'Qora',     ru: 'Чёрный',   en: 'Black' },
    // LOOM-166: a product, size or colour switched off in admin (also the server's refusal codes)
    'cfg.unavailable':        { uz: 'Mavjud emas', ru: 'Недоступно', en: 'Unavailable' },
    'cfg.productUnavailable': { uz: 'Bu mahsulot hozir mavjud emas', ru: 'Этот товар сейчас недоступен', en: 'This product is unavailable' },
    'cfg.sizeUnavailable':    { uz: 'Bu o‘lcham mavjud emas — boshqasini tanlang', ru: 'Этот размер недоступен — выберите другой', en: 'This size is unavailable — choose another' },
    'cfg.colorUnavailable':   { uz: 'Bu rang mavjud emas — boshqasini tanlang', ru: 'Этот цвет недоступен — выберите другой', en: 'This colour is unavailable — choose another' },
    // LOOM-226: a garment sold with colour and size only (also the server's print_unavailable)
    'cfg.blankNote':          { uz: 'Bu mahsulot bosmasiz sotiladi', ru: 'Этот товар продаётся без принта', en: 'This item is sold without a print' },
    'cfg.toastAddedCart':  { uz: 'Savatga qo‘shildi', ru: 'Добавлено в корзину', en: 'Added to cart' },
    'cfg.preparing':       { uz: 'Maketlar tayyorlanmoqda…', ru: 'Готовим макеты…', en: 'Preparing proofs…' },
    'cfg.toastLoginCart':  { uz: 'Savatga qo‘shish uchun tizimga kiring', ru: 'Войдите, чтобы добавить в корзину', en: 'Sign in to add to cart' },
    'cfg.toastAddError':   { uz: 'Qo‘shishda xatolik', ru: 'Ошибка добавления', en: 'Could not add item' },
    'cfg.untouchedTextCart': { uz: 'Savatga qo‘shishdan oldin matn kiriting yoki bu matn qatlamini o‘chiring.', ru: 'Введите текст или удалите этот текстовый слой, чтобы добавить товар в корзину.', en: 'Enter text or remove this text layer before adding the item to your bag.' },
    'cfg.toastCartUpdated':{ uz: 'Savat yangilandi', ru: 'Корзина обновлена', en: 'Cart updated' },
    'cfg.editingFromCart': { uz: 'Savatdagi mahsulot tahrirlanmoqda — qo‘shilganda saqlanadi', ru: 'Редактируем товар из корзины — сохранится при добавлении', en: 'Editing a bag item — re-add to save changes' },
    'cfg.uploadErrType':   { uz: 'Iltimos, rasm faylini yuklang (PNG, JPG, WebP, HEIC, SVG)', ru: 'Пожалуйста, загрузите файл изображения (PNG, JPG, WebP, HEIC, SVG)', en: 'Please upload an image file (PNG, JPG, WebP, HEIC, SVG)' },
    'cfg.uploadErrSize':   { uz: 'Fayl juda katta (maks. 15 MB)', ru: 'Файл слишком большой (макс. 15 МБ)', en: 'File is too large (max 15 MB)' },
    'cfg.uploadErrRead':   { uz: 'Rasmni ochib bo‘lmadi. JPG yoki PNG faylni sinab ko‘ring.', ru: 'Не удалось открыть изображение. Попробуйте файл JPG или PNG.', en: 'Could not open this image. Try a JPG or PNG file.' },
    'cfg.uploadErrLogo':   { uz: 'Logotipni yuklashda xatolik. Buyurtma berishdan oldin qayta urinib ko‘ring.', ru: 'Ошибка загрузки логотипа. Пожалуйста, попробуйте снова перед отправкой заказа.', en: 'Could not upload your logo. Please try again before placing the order.' },
    'cfg.uploadLowDpi':    { uz: 'Past sifat: bu o‘lchamda rasm xira chiqishi mumkin. Uni kichraytiring yoki kattaroq fayl yuklang.', ru: 'Низкое разрешение: при таком размере печать может быть размытой. Уменьшите изображение или загрузите файл побольше.', en: 'Low resolution: this image may print blurry at this size. Make it smaller or upload a larger file.' },
    'cfg.uploading':       { uz: 'Rasm yuklanmoqda…', ru: 'Загружаем картинку…', en: 'Uploading the image…' },
    'cfg.cancel':          { uz: 'Bekor qilish', ru: 'Отмена', en: 'Cancel' },
    'cfg.lowDpiShort':     { uz: 'Past sifat: bu o‘lchamda rasm xira chiqishi mumkin.', ru: 'Низкое качество: при таком размере печать может быть размытой.', en: 'Low quality: at this size the print may look blurry.' },

    // ===== Bag (shared cart drawer) =====
    'cart.edit':    { uz: 'O‘zgartirish', ru: 'Изменить',  en: 'Edit' },
    'cart.remove':  { uz: 'O‘chirish',    ru: 'Удалить',   en: 'Remove' },
    'cart.plain':   { uz: 'Printsiz',     ru: 'Без принта', en: 'No print' },
    'cart.item':    { uz: 'Futbolka',     ru: 'Футболка',  en: 'T-shirt' },
    'cart.size':    { uz: 'O‘lcham',      ru: 'Размер',    en: 'Size' },
    'cart.added':   { uz: 'Savatga qo‘shildi', ru: 'Добавлено в корзину', en: 'Added to bag' },

    // ===== Checkout page =====
    'co.cod':          { uz: 'Qabul qilishda to‘lov', ru: 'При получении', en: 'On delivery' },
    'co.codHint':      { uz: 'Naqd yoki karta orqali', ru: 'Наличными или картой', en: 'Cash or card' },
    'co.needName':     { uz: 'Ismingizni kiriting', ru: 'Укажите имя', en: 'Enter your name' },
    'co.needPhone':    { uz: 'To‘g‘ri raqam kiriting', ru: 'Укажите корректный номер', en: 'Enter a valid phone' },
    'co.needAddr':     { uz: 'Xaritada manzilni belgilang', ru: 'Укажите адрес на карте', en: 'Pick your address on the map' },
    'co.errGeneric':   { uz: 'Buyurtma yuborilmadi. Qayta urinib ko‘ring.', ru: 'Не удалось оформить заказ. Попробуйте ещё раз.', en: 'Could not place the order. Please try again.' },
    'co.sessionLost':  { uz: 'Sessiya tugadi. Buyurtma berish uchun qayta kiring.', ru: 'Сессия истекла. Войдите заново, чтобы оформить заказ.', en: 'Your session expired. Sign in again to place the order.' },
    'co.addrPending':  { uz: 'Manzil aniqlanmoqda — bir soniya kuting', ru: 'Определяем адрес — подождите секунду', en: 'Resolving the address — one moment' },
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
    'sg.measureLength': { uz: 'Uzunlik: yelka choqidan kiyimning past chetigacha.', ru: 'Длина: от шва плеча до нижнего края изделия.', en: 'Length: from the shoulder seam to the bottom hem.' },
    'sg.tip':        { uz: 'Maslahat: ikki o‘lcham orasida bo‘lsangiz, erkinroq fason uchun kattaroq o‘lchamni tanlang.', ru: 'Совет: если вы между размерами, берите больший для свободной посадки.', en: 'Tip: between two sizes? Pick the larger one for a relaxed fit.' },

    // ===== Order modal =====
    'order.namePh':      { uz: 'Ismingizni kiriting', ru: 'Введите ваше имя', en: 'Enter your name' },


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
    'auth.register':    { uz: 'Ro‘yxatdan o‘tish', ru: 'Зарегистрироваться', en: 'Sign up' },

    // Telegram-verified sign up / sign in

    // Social sign-in (assets/oauth.js). Which of these ever render is decided
    // by the Worker — a provider without credentials is never drawn.

    // Forgot-password recovery
    'auth.errPhone':   { uz: 'To‘liq telefon raqamini kiriting', ru: 'Введите полный номер телефона', en: 'Enter the full phone number' },
    'reset.expired':   { uz: 'Vaqt tugadi. Qaytadan urinib ko‘ring.', ru: 'Время ожидания истекло. Попробуйте снова.', en: 'Timed out. Please try again.' },

    // ===== LOOM Lab (index.html band, lab.html, configurator tile) =====
    'lab.f1':         { uz: 'Matnli tavsifdan bosma', ru: 'Принт из текстового описания', en: 'A print from a written description' },
    'lab.f2':         { uz: 'Fonni avtomatik olib tashlash', ru: 'Автоматическое удаление фона', en: 'Automatic background removal' },
    'lab.f3':         { uz: 'Bosmaga tayyor o‘lcham', ru: 'Готовое к печати разрешение', en: 'Print-ready resolution' },
    'lab.soon':       { uz: 'Tez orada', ru: 'Скоро', en: 'Coming soon' },
    'lab.more':       { uz: 'Bu nima bo‘ladi →', ru: 'Что это будет →', en: 'What it will be →' },
    'lab.tileTitle':  { uz: 'LOOM Lab bilan o‘ylab topish', ru: 'Придумать с LOOM Lab', en: 'Invent it with LOOM Lab' },
    'lab.tileSub':    { uz: 'Bosmani so‘z bilan tasvirlang — Lab chizib beradi', ru: 'Опишите принт словами — Lab нарисует его', en: 'Describe the print — Lab will draw it' },
    'lab.sheetTitle': { uz: 'LOOM Lab', ru: 'LOOM Lab', en: 'LOOM Lab' },
    'lab.sheetLead':  { uz: 'Bosmani oddiy ibora bilan tasvirlang — Lab uni chizadi, fonni oladi va kiyimga bosma o‘lchamida joylaydi.', ru: 'Опишите принт обычной фразой — Lab нарисует его, уберёт фон и положит на одежду в печатном разрешении.', en: 'Describe the print in a plain sentence — Lab draws it, removes the background and puts it on the garment at print resolution.' },
    'cfg.close':      { uz: 'Yopish', ru: 'Закрыть', en: 'Close' },


    // ===== Marketplace (market.html, designer.html) =====
    'mk.moreFailed':  { uz: 'Yuklab bo‘lmadi. Qayta urinib ko‘ring.', ru: 'Не удалось загрузить. Попробуйте ещё раз.', en: 'Could not load. Please try again.' },
    'mk.loadMore':    { uz: 'Yana ko‘rsatish', ru: 'Показать ещё', en: 'Show more' },
    // ----- Designer directory (designers.html) -----
    'dir.sold':     { uz: 'sotilgan', ru: 'продано', en: 'sold' },
    'nav.designers':{ uz: 'Dizaynerlar', ru: 'Дизайнеры', en: 'Designers' },

    // ----- Market: open call shown when there are no works yet -----

    'mk.designer':    { uz: 'Dizayner', ru: 'Дизайнер', en: 'Designer' },
    'mk.notFound':    { uz: 'Dizayner topilmadi', ru: 'Дизайнер не найден', en: 'Designer not found' },
    'mk.applied':     { uz: 'Dizayn qo‘shildi', ru: 'Дизайн добавлен', en: 'Design added' },
    'mk.applyFailed': { uz: 'Ishni yuklab bo‘lmadi', ru: 'Не удалось загрузить работу', en: 'Could not load that work' },

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
    'dz.notImage':    { uz: 'Bu rasmga o‘xshamaydi.', ru: 'Это не похоже на картинку.', en: 'That does not look like an image.' },
    'dz.tooSmall':    { uz: 'Uzun tomoni kamida {n} px bo‘lsin — sizda {w}×{h}.', ru: 'Минимум {n} px по длинной стороне — у вас {w}×{h}.', en: 'At least {n} px on the long edge — yours is {w}×{h}.' },
    'dz.myWorks':     { uz: 'Mening ishlarim', ru: 'Мои работы', en: 'My works' },
    'dz.noWorks':     { uz: 'Siz hali hech narsa yuklamadingiz. Yuqoridagi shakldan boshlang.', ru: 'Вы пока ничего не загрузили. Начните с формы выше.', en: 'You have not uploaded anything yet. Start with the form above.' },
    'dz.noPublicWorks': { uz: 'Bu dizaynerda hali tasdiqlangan ishlar yo‘q.', ru: 'У этого дизайнера пока нет одобренных работ.', en: 'This designer has no approved works yet.' },
    'dz.soldTimes':   { uz: 'Sotilgan: ', ru: 'Продано: ', en: 'Sold: ' },


    // ===== LOOM-323 Atelye site (mockup v3). Pages render atl-* classes and read only atl.* keys. =====
    // Shell: header, bottom nav, footer
    'atl.nav.home': { uz: "Bosh sahifa", ru: "Главная", en: "Home" },
    'atl.nav.tabHome': { uz: "Asosiy", ru: "Главная", en: "Home" },
    'atl.nav.catalog': { uz: "Katalog", ru: "Каталог", en: "Catalogue" },
    'atl.nav.market': { uz: "Market", ru: "Маркет", en: "Market" },
    'atl.nav.designers': { uz: "Dizaynerlar", ru: "Дизайнеры", en: "Designers" },
    'atl.nav.lab': { uz: "LOOM Lab", ru: "LOOM Lab", en: "LOOM Lab" },
    'atl.nav.help': { uz: "Yordam", ru: "Помощь", en: "Help" },
    'atl.nav.create': { uz: "Dizayn yaratish", ru: "Создать дизайн", en: "Create a design" },
    'atl.nav.tabCreate': { uz: "Yaratish", ru: "Создать", en: "Create" },
    'atl.nav.cart': { uz: "Savat", ru: "Корзина", en: "Cart" },
    'atl.nav.cartCount': { uz: "Savat, {n} ta", ru: "Корзина, товаров: {n}", en: "Cart, {n} items" },
    'atl.nav.profile': { uz: "Profil", ru: "Профиль", en: "Profile" },
    'atl.nav.back': { uz: "Orqaga", ru: "Назад", en: "Back" },
    'atl.nav.search': { uz: "Qidirish", ru: "Поиск", en: "Search" },
    'atl.nav.main': { uz: "Asosiy", ru: "Основное меню", en: "Main menu" },
    'atl.nav.homeAria': { uz: "LOOM bosh sahifa", ru: "LOOM — на главную", en: "LOOM home" },
    'atl.nav.skipToMain': { uz: "Asosiy qismga o‘tish", ru: "Перейти к содержимому", en: "Skip to content" },
    'atl.nav.language': { uz: "Til", ru: "Язык", en: "Language" },
    'atl.nav.theme': { uz: "Mavzu", ru: "Тема", en: "Theme" },
    'atl.foot.aria': { uz: "Pastki", ru: "Нижнее меню", en: "Footer" },
    'atl.foot.legal': { uz: "Maxfiylik va shartlar", ru: "Конфиденциальность и условия", en: "Privacy and terms" },
    'atl.foot.becomeDesigner': { uz: "Dizayner bo‘lish", ru: "Стать дизайнером", en: "Become a designer" },
    'atl.foot.lang': { uz: "Til: {lang}", ru: "Язык: {lang}", en: "Language: {lang}" },
    'atl.foot.address': { uz: "Toshkent, O‘zbekiston", ru: "Ташкент, Узбекистан", en: "Tashkent, Uzbekistan" },
    'atl.foot.contact': { uz: "Telegram: @looom_design_bot", ru: "Telegram: @looom_design_bot", en: "Telegram: @looom_design_bot" },
    // Common words
    'atl.soon': { uz: "Tez orada", ru: "Скоро", en: "Coming soon" },
    'atl.optional': { uz: "ixtiyoriy", ru: "необязательно", en: "optional" },
    'atl.verified': { uz: "Tasdiqlangan", ru: "Подтверждён", en: "Verified" },
    'atl.copy': { uz: "Nusxa olish", ru: "Скопировать", en: "Copy" },
    'atl.copied': { uz: "Nusxa olindi", ru: "Скопировано", en: "Copied" },
    'atl.close': { uz: "Yopish", ru: "Закрыть", en: "Close" },
    'atl.cancel': { uz: "Bekor qilish", ru: "Отмена", en: "Cancel" },
    'atl.save': { uz: "Saqlash", ru: "Сохранить", en: "Save" },
    'atl.saved': { uz: "Saqlandi!", ru: "Сохранено!", en: "Saved!" },
    'atl.next': { uz: "Keyingi", ru: "Далее", en: "Next" },
    'atl.skip': { uz: "O‘tkazib yuborish", ru: "Пропустить", en: "Skip" },
    'atl.continue': { uz: "Davom etish", ru: "Продолжить", en: "Continue" },
    'atl.loading': { uz: "Yuklanmoqda", ru: "Загрузка", en: "Loading" },
    'atl.sending': { uz: "Yuborilmoqda…", ru: "Отправляем…", en: "Sending…" },
    'atl.reload': { uz: "Yangilash", ru: "Обновить", en: "Reload" },
    'atl.pcs': { uz: "{n} dona", ru: "{n} шт.", en: "{n} pcs" },
    'atl.from': { uz: "{price} dan", ru: "от {price}", en: "from {price}" },
    'atl.blankOnly': { uz: "Faqat printsiz", ru: "Только без принта", en: "Blank only" },
    'atl.withDelivery': { uz: "yetkazish bilan", ru: "с доставкой", en: "incl. delivery" },
    'atl.prepaid': { uz: "oldindan to‘lov", ru: "предоплата", en: "paid upfront" },
    'atl.questions': { uz: "Savol bo‘lsa: Telegram @looom_design_bot", ru: "Вопросы — в Telegram @looom_design_bot", en: "Questions? Telegram @looom_design_bot" },
    // Working hours: ONE value for every language. Placeholder until Tim confirms (plan Q3).
    'atl.hours': { uz: "9:00–21:00", ru: "9:00–21:00", en: "9:00–21:00" },
    'atl.workHours': { uz: "Ish vaqti: {hours}", ru: "Часы работы: {hours}", en: "Working hours: {hours}" },
    'atl.theme.auto': { uz: "Avto", ru: "Авто", en: "Auto" },
    'atl.theme.autoSub': { uz: "Telefon sozlamasiga qarab", ru: "Как в настройках телефона", en: "Follows your phone setting" },
    'atl.theme.light': { uz: "Yorug‘", ru: "Светлая", en: "Light" },
    'atl.theme.dark': { uz: "Qorong‘i", ru: "Тёмная", en: "Dark" },
    // Onboarding, first web visit (3 cards)
    'atl.onb.t1': { uz: "Kiyimni tanlang", ru: "Выберите вещь", en: "Pick a garment" },
    'atl.onb.l1': { uz: "Futbolka, xudi, polo. Oq yoki qora. O‘lchamlar XS dan XXXL gacha.", ru: "Футболка, худи, поло. Белый или чёрный цвет. Размеры от XS до XXXL.", en: "T-shirt, hoodie or polo, in white or black. Sizes XS to XXXL." },
    'atl.onb.t2': { uz: "Rasm yoki matn qo‘shing", ru: "Добавьте картинку или текст", en: "Add an image or text" },
    'atl.onb.l2': { uz: "Rasmingizni yuklang yoki yozing. Kiyim ustida suring, kattalashtiring, 3D da ko‘ring.", ru: "Загрузите картинку или напишите текст. Двигайте и увеличивайте прямо на вещи, смотрите в 3D.", en: "Upload a picture or type some text. Move and resize it on the garment, then see it in 3D." },
    'atl.onb.t3': { uz: "Oldindan to‘laysiz", ru: "Оплата заранее", en: "You pay upfront" },
    'atl.onb.l3': { uz: "Buyurtmani LOOM kartasiga o‘tkazma bilan to‘laysiz. Toshkentda 2–4 ish kunida yetkazamiz, yetkazish 30 000 so‘m.", ru: "Заказ оплачивается переводом на карту LOOM. По Ташкенту доставим за 2–4 рабочих дня, доставка — 30 000 сум.", en: "You pay by transfer to the LOOM card. We deliver in Tashkent in 2–4 working days; delivery is 30 000 UZS." },
    // Login: phone + Telegram only
    'atl.login.title': { uz: "Kirish", ru: "Вход", en: "Sign in" },
    'atl.login.h1': { uz: "Akkauntga kirish", ru: "Вход в аккаунт", en: "Sign in to your account" },
    'atl.login.lead': { uz: "Buyurtmalarni kuzatish uchun kiring. Yangi raqam bo‘lsa, akkaunt o‘zi ochiladi.", ru: "Войдите, чтобы следить за заказами. Если номер новый, аккаунт создастся сам.", en: "Sign in to track your orders. A new number creates an account automatically." },
    'atl.login.phone': { uz: "Telefon raqami", ru: "Номер телефона", en: "Phone number" },
    'atl.login.phonePh': { uz: "90 123 45 67", ru: "90 123 45 67", en: "90 123 45 67" },
    'atl.login.phoneHint': { uz: "Raqamni Telegram orqali tasdiqlaymiz — tez va parolsiz.", ru: "Номер подтвердим через Telegram — быстро и без пароля.", en: "We confirm your number through Telegram — quick, no password." },
    'atl.login.viaTg': { uz: "Telegram orqali davom etish", ru: "Продолжить через Telegram", en: "Continue with Telegram" },
    'atl.login.sms': { uz: "SMS kod orqali · Tez orada", ru: "По SMS-коду · скоро", en: "SMS code · coming soon" },
    'atl.login.termsHtml': { uz: "Davom etish orqali siz <a href=\"/privacy\">shartlar va maxfiylik qoidalariga</a> rozilik bildirasiz.", ru: "Продолжая, вы соглашаетесь с <a href=\"/privacy\">условиями и политикой конфиденциальности</a>.", en: "By continuing you agree to the <a href=\"/privacy\">terms and privacy policy</a>." },
    'atl.login.waitH1': { uz: "Telegramda tasdiqlang", ru: "Подтвердите в Telegram", en: "Confirm in Telegram" },
    'atl.login.waitLead': { uz: "@looom_design_bot ochildi. Unda ikki narsani bosing:", ru: "Открылся @looom_design_bot. Нажмите там две кнопки:", en: "@looom_design_bot is open. Tap two things there:" },
    'atl.login.s1': { uz: "Start", ru: "Start", en: "Start" },
    'atl.login.s1Sub': { uz: "Bot sizni taniydi", ru: "Бот узнает вас", en: "The bot recognises you" },
    'atl.login.s2': { uz: "Raqamni ulashish", ru: "Поделиться номером", en: "Share your number" },
    'atl.login.s2Sub': { uz: "{phone} raqami bilan", ru: "Номер {phone}", en: "Using {phone}" },
    'atl.login.s3': { uz: "Saytga avtomatik kirasiz", ru: "Вход на сайт произойдёт сам", en: "You are signed in automatically" },
    'atl.login.s3Sub': { uz: "Bu sahifa o‘zi yangilanadi", ru: "Эта страница обновится сама", en: "This page updates by itself" },
    'atl.login.waiting': { uz: "Tasdiqlash kutilmoqda… Havola 10 daqiqa amal qiladi.", ru: "Ждём подтверждения… Ссылка действует 10 минут.", en: "Waiting for confirmation… The link works for 10 minutes." },
    'atl.login.reopen': { uz: "Botni qayta ochish", ru: "Открыть бота ещё раз", en: "Open the bot again" },
    'atl.login.changeNum': { uz: "Raqamni o‘zgartirish", ru: "Изменить номер", en: "Change number" },
    'atl.login.doneH1': { uz: "Kirdingiz", ru: "Вы вошли", en: "You are signed in" },
    'atl.login.doneLead': { uz: "Raqamingiz tasdiqlandi. Qaytaramiz…", ru: "Номер подтверждён. Возвращаем вас…", en: "Your number is confirmed. Taking you back…" },
    'atl.login.toProfile': { uz: "Profilga o‘tish", ru: "Перейти в профиль", en: "Go to profile" },
    'atl.login.mismatch': { uz: "Raqam mos kelmadi. Siz {phone} kiritdingiz, Telegramda boshqa raqam ulashildi. To‘g‘ri raqamni kiriting yoki Telegramdagi raqamingiz bilan kiring.", ru: "Номера не совпали. Вы ввели {phone}, а в Telegram поделились другим номером. Введите правильный номер или войдите с номером из Telegram.", en: "The numbers do not match. You entered {phone}, but a different number was shared in Telegram. Enter the right number or sign in with your Telegram number." },
    'atl.login.errRate': { uz: "Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.", ru: "Слишком много попыток. Попробуйте снова через несколько минут.", en: "Too many attempts. Try again in a few minutes." },
    'atl.login.errNet': { uz: "Internet yo‘q. Ulanishni tekshirib, qayta urinib ko‘ring.", ru: "Нет интернета. Проверьте подключение и попробуйте снова.", en: "No internet. Check your connection and try again." },
    // Home
    'atl.home.h1': { uz: "O‘ylab topganingizni kiying.", ru: "Носите то, что придумали.", en: "Wear what you dream up." },
    'atl.home.lead': { uz: "Kiyimni tanlang, rasm yoki matn qo‘shing, 3D da ko‘ring. Butun O‘zbekiston bo‘ylab yetkazamiz.", ru: "Выберите вещь, добавьте картинку или текст, посмотрите в 3D. Доставляем по всему Узбекистану.", en: "Pick a garment, add an image or text and see it in 3D. We deliver across Uzbekistan." },
    'atl.home.toCatalog': { uz: "Katalogni ko‘rish", ru: "Смотреть каталог", en: "Browse the catalogue" },
    'atl.home.openCfg': { uz: "Konstruktorni ochish", ru: "Открыть конструктор", en: "Open the designer" },
    'atl.home.fact1': { uz: "2–4 kun", ru: "2–4 дня", en: "2–4 days" },
    'atl.home.fact1Sub': { uz: "Toshkentda yetkazish, 30 000 so‘m", ru: "доставка по Ташкенту, 30 000 сум", en: "delivery in Tashkent, 30 000 UZS" },
    'atl.home.fact2': { uz: "Oldindan to‘lov", ru: "Предоплата", en: "Paid upfront" },
    'atl.home.fact2Sub': { uz: "LOOM kartasiga o‘tkazma", ru: "перевод на карту LOOM", en: "transfer to the LOOM card" },
    'atl.home.fact3': { uz: "30 × 40 sm", ru: "30 × 40 см", en: "30 × 40 cm" },
    'atl.home.fact3Sub': { uz: "bosma maydoni", ru: "область печати", en: "print area" },
    'atl.home.garments': { uz: "Kiyimlar", ru: "Одежда", en: "Garments" },
    'atl.home.seeAll': { uz: "Hammasini ko‘rish", ru: "Смотреть все", en: "See all" },
    'atl.home.steps': { uz: "Uch qadam", ru: "Три шага", en: "Three steps" },
    'atl.home.s1': { uz: "Kiyim va rang", ru: "Вещь и цвет", en: "Garment and colour" },
    'atl.home.s1Sub': { uz: "Oq yoki qora, o‘lchamni keyin tanlaysiz.", ru: "Белая или чёрная, размер выберете потом.", en: "White or black; you pick the size later." },
    'atl.home.s2': { uz: "Rasm yoki matn", ru: "Картинка или текст", en: "Image or text" },
    'atl.home.s2Sub': { uz: "Yuklang, suring, kattalashtiring. 2D va 3D.", ru: "Загрузите, подвиньте, увеличьте. В 2D и 3D.", en: "Upload, move, resize. In 2D and 3D." },
    'atl.home.s3': { uz: "Buyurtma", ru: "Заказ", en: "Order" },
    'atl.home.s3Sub': { uz: "Kartaga o‘tkazma, chekni yuklaysiz, tasdiqlangach tikamiz.", ru: "Переводите на карту, загружаете чек — после подтверждения запускаем в работу.", en: "Transfer to the card, upload the receipt, and we start making it once payment is confirmed." },
    'atl.home.works': { uz: "Dizaynerlar ishlari", ru: "Работы дизайнеров", en: "Designer prints" },
    'atl.home.toMarket': { uz: "Marketga", ru: "В маркет", en: "To the market" },
    'atl.home.labSub': { uz: "So‘z bilan tasvirlang — printni Lab chizadi", ru: "Опишите словами — Lab нарисует принт", en: "Describe it in words — Lab draws the print" },
    // Catalogue
    'atl.cat.h1': { uz: "Katalog", ru: "Каталог", en: "Catalogue" },
    'atl.cat.lead': { uz: "Asosni tanlang. Printni konstruktorda qo‘shasiz.", ru: "Выберите основу. Принт добавите в конструкторе.", en: "Choose a base. You add the print in the designer." },
    'atl.cat.typeAria': { uz: "Turi", ru: "Тип", en: "Type" },
    'atl.cat.all': { uz: "Hammasi", ru: "Все", en: "All" },
    'atl.cat.tee': { uz: "Futbolka", ru: "Футболка", en: "T-shirt" },
    'atl.cat.hoodie': { uz: "Xudi", ru: "Худи", en: "Hoodie" },
    'atl.cat.polo': { uz: "Polo", ru: "Поло", en: "Polo" },
    'atl.cat.sweat': { uz: "Svitshot", ru: "Свитшот", en: "Sweatshirt" },
    'atl.cat.cap': { uz: "Kepka", ru: "Кепка", en: "Cap" },
    'atl.cat.pants': { uz: "Shim", ru: "Штаны", en: "Joggers" },
    // Product page
    'atl.prod.color': { uz: "Rang: {color}", ru: "Цвет: {color}", en: "Colour: {color}" },
    'atl.prod.size': { uz: "O‘lcham", ru: "Размер", en: "Size" },
    'atl.prod.sizeTable': { uz: "O‘lchamlar jadvali", ru: "Таблица размеров", en: "Size chart" },
    'atl.prod.pickSize': { uz: "O‘lchamni tanlang", ru: "Выберите размер", en: "Choose a size" },
    'atl.prod.noSize': { uz: "O‘lcham tanlanmagan", ru: "Размер не выбран", en: "No size selected" },
    'atl.prod.sizeNone': { uz: "O‘lcham: —", ru: "Размер: —", en: "Size: —" },
    'atl.prod.sizeIs': { uz: "O‘lcham: {size}", ru: "Размер: {size}", en: "Size: {size}" },
    'atl.prod.addDesign': { uz: "Dizayn qo‘shish", ru: "Добавить дизайн", en: "Add a design" },
    'atl.prod.addDesignShort': { uz: "Dizayn", ru: "Дизайн", en: "Design" },
    'atl.prod.blankToCart': { uz: "Printsiz savatga", ru: "В корзину без принта", en: "Add blank to cart" },
    'atl.prod.blankShort': { uz: "Printsiz", ru: "Без принта", en: "Blank" },
    'atl.prod.addToCart': { uz: "Savatga qo‘shish", ru: "В корзину", en: "Add to cart" },
    'atl.prod.delivery': { uz: "Yetkazish {amount}", ru: "Доставка {amount}", en: "Delivery {amount}" },
    'atl.prod.deliverySub': { uz: "Toshkentda ishlab chiqarishdan keyin 2–4 ish kuni", ru: "По Ташкенту — 2–4 рабочих дня после производства", en: "In Tashkent, 2–4 working days after production" },
    'atl.prod.prepay': { uz: "Oldindan to‘lov", ru: "Предоплата", en: "Paid upfront" },
    'atl.prod.prepaySub': { uz: "LOOM kartasiga o‘tkazma, chek bilan", ru: "Перевод на карту LOOM, с чеком", en: "Transfer to the LOOM card, with a receipt" },
    'atl.prod.area': { uz: "Bosma maydoni 30 × 40 sm", ru: "Область печати 30 × 40 см", en: "Print area 30 × 40 cm" },
    'atl.prod.areaSub': { uz: "Rangi ekranda bosmadan biroz farq qilishi mumkin", ru: "Цвет на экране может немного отличаться от печати", en: "Colours on screen may differ slightly from the print" },
    // Cart page and price lines
    'atl.cart.title': { uz: "Savat", ru: "Корзина", en: "Cart" },
    'atl.cart.titleN': { uz: "Savat · {n}", ru: "Корзина · {n}", en: "Cart · {n}" },
    'atl.cart.empty': { uz: "Savat bo‘sh", ru: "Корзина пуста", en: "Your cart is empty" },
    'atl.cart.emptyLead': { uz: "Kiyimni tanlang va dizayn qo‘shing — u shu yerda paydo bo‘ladi.", ru: "Выберите вещь и добавьте дизайн — она появится здесь.", en: "Pick a garment and add a design — it will show up here." },
    'atl.cart.toCatalog': { uz: "Katalogga o‘tish", ru: "Перейти в каталог", en: "Go to the catalogue" },
    'atl.cart.dec': { uz: "Kamaytirish", ru: "Уменьшить", en: "Decrease" },
    'atl.cart.inc': { uz: "Ko‘paytirish", ru: "Увеличить", en: "Increase" },
    'atl.cart.edit': { uz: "O‘zgartirish", ru: "Изменить", en: "Edit" },
    'atl.cart.remove': { uz: "O‘chirish", ru: "Удалить", en: "Remove" },
    'atl.cart.prepayNote': { uz: "To‘lov oldindan va to‘liq: LOOM kartasiga o‘tkazma. Karta raqami to‘lov qadamida chiqadi.", ru: "Оплата заранее и полностью: перевод на карту LOOM. Номер карты покажем на шаге оплаты.", en: "Payment is upfront and in full, by transfer to the LOOM card. You see the card number at the payment step." },
    'atl.cart.checkout': { uz: "Rasmiylashtirish", ru: "Оформить", en: "Check out" },
    'atl.sum.items': { uz: "Mahsulotlar", ru: "Товары", en: "Items" },
    'atl.sum.delivery': { uz: "Yetkazib berish", ru: "Доставка", en: "Delivery" },
    'atl.sum.total': { uz: "Jami", ru: "Итого", en: "Total" },
    // Checkout
    'atl.co.title': { uz: "Rasmiylashtirish", ru: "Оформление", en: "Checkout" },
    'atl.co.h1': { uz: "Buyurtmani rasmiylashtirish", ru: "Оформление заказа", en: "Place your order" },
    'atl.co.contact': { uz: "Aloqa ma’lumotlari", ru: "Контакты", en: "Contact details" },
    'atl.co.name': { uz: "Ism", ru: "Имя", en: "Name" },
    'atl.co.verifyBanner': { uz: "Buyurtma uchun raqamni Telegram orqali tasdiqlang.", ru: "Чтобы оформить заказ, подтвердите номер через Telegram.", en: "Confirm your number through Telegram to place the order." },
    'atl.co.verifyBtn': { uz: "Telegram orqali tasdiqlash", ru: "Подтвердить через Telegram", en: "Confirm with Telegram" },
    'atl.co.delivery': { uz: "Yetkazib berish · {amount}", ru: "Доставка · {amount}", en: "Delivery · {amount}" },
    'atl.co.addr': { uz: "Manzil", ru: "Адрес", en: "Address" },
    'atl.co.addrPh': { uz: "Ko‘cha, uy, mo‘ljal…", ru: "Улица, дом, ориентир…", en: "Street, building, landmark…" },
    'atl.co.savedAddr': { uz: "saqlangan manzil", ru: "сохранённый адрес", en: "saved address" },
    'atl.co.otherAddr': { uz: "Boshqa manzil", ru: "Другой адрес", en: "Another address" },
    'atl.co.otherAddrSub': { uz: "Xaritada yoki qo‘lda kiriting", ru: "На карте или вручную", en: "On the map or by hand" },
    'atl.co.entrance': { uz: "Podyezd", ru: "Подъезд", en: "Entrance" },
    'atl.co.apt': { uz: "Xonadon", ru: "Квартира", en: "Flat" },
    'atl.co.floor': { uz: "Qavat", ru: "Этаж", en: "Floor" },
    'atl.co.intercom': { uz: "Domofon", ru: "Домофон", en: "Intercom" },
    'atl.co.note': { uz: "Kuryer uchun izoh", ru: "Комментарий для курьера", en: "Note for the courier" },
    'atl.co.notePh': { uz: "Masalan: oldindan qo‘ng‘iroq qiling…", ru: "Например: позвоните заранее…", en: "For example: call before you come…" },
    'atl.co.needAddr': { uz: "Yetkazib berish manzilini kiriting", ru: "Укажите адрес доставки", en: "Enter a delivery address" },
    'atl.co.notSent': { uz: "Buyurtma yuborilmadi. Yetkazib berish manzilini kiriting.", ru: "Заказ не отправлен. Укажите адрес доставки.", en: "The order was not sent. Enter a delivery address." },
    'atl.co.payment': { uz: "To‘lov", ru: "Оплата", en: "Payment" },
    'atl.co.p2p': { uz: "Kartaga o‘tkazma", ru: "Перевод на карту", en: "Card transfer" },
    'atl.co.p2pSub': { uz: "LOOM kartasiga, buyurtmadan oldin to‘liq summa", ru: "На карту LOOM, полная сумма заранее", en: "To the LOOM card, the full amount in advance" },
    'atl.co.payHint': { uz: "Karta raqami va aniq summa keyingi sahifada chiqadi.", ru: "Номер карты и точную сумму покажем на следующей странице.", en: "You see the card number and the exact amount on the next page." },
    'atl.co.summary': { uz: "Sizning buyurtmangiz", ru: "Ваш заказ", en: "Your order" },
    'atl.co.toPay': { uz: "To‘lovga o‘tish", ru: "Перейти к оплате", en: "Go to payment" },
    'atl.co.terms': { uz: "Davom etish orqali siz buyurtma va yetkazib berish shartlariga rozilik bildirasiz.", ru: "Продолжая, вы соглашаетесь с условиями заказа и доставки.", en: "By continuing you agree to the order and delivery terms." },
    'atl.co.noServer': { uz: "Server bilan aloqa yo‘q. Qayta urinib ko‘ring.", ru: "Нет связи с сервером. Попробуйте ещё раз.", en: "Cannot reach the server. Please try again." },
    'atl.co.p2pOff': { uz: "To‘lov vaqtincha ishlamayapti. Bir necha daqiqadan keyin sahifani yangilang.", ru: "Оплата временно недоступна. Обновите страницу через несколько минут.", en: "Payment is temporarily unavailable. Refresh the page in a few minutes." },
    'atl.co.methodOff': { uz: "Bu to‘lov usuli hozir ishlamaydi. Sahifani yangilab, qayta urinib ko‘ring.", ru: "Этот способ оплаты сейчас недоступен. Обновите страницу и попробуйте снова.", en: "This payment method is not available right now. Refresh the page and try again." },
    // Payment page (order.html while unpaid)
    'atl.pay.title': { uz: "To‘lov · {order}", ru: "Оплата · {order}", en: "Payment · {order}" },
    'atl.pay.timer': { uz: "30 daqiqa ichida to‘lang · {time} qoldi", ru: "Оплатите в течение 30 минут · осталось {time}", en: "Pay within 30 minutes · {time} left" },
    'atl.pay.reminder': { uz: "5 daqiqa qoldi. Chekni yuklang, aks holda buyurtma bekor bo‘ladi. Telegramga ham eslatma yubordik.", ru: "Осталось 5 минут. Загрузите чек, иначе заказ отменится. Мы также напомнили в Telegram.", en: "5 minutes left. Upload the receipt or the order is cancelled. We also sent a reminder in Telegram." },
    'atl.pay.amount': { uz: "To‘lanadigan summa", ru: "Сумма к оплате", en: "Amount to pay" },
    'atl.pay.amountNote': { uz: "Aynan shu summani o‘tkazing: mahsulotlar {items} + yetkazish {delivery}.", ru: "Переведите ровно эту сумму: товары {items} + доставка {delivery}.", en: "Transfer exactly this amount: items {items} + delivery {delivery}." },
    'atl.pay.card': { uz: "LOOM kartasi", ru: "Карта LOOM", en: "LOOM card" },
    'atl.pay.holder': { uz: "Karta egasi: {holder}", ru: "Владелец карты: {holder}", en: "Card holder: {holder}" },
    'atl.pay.s1': { uz: "Bank ilovasini oching", ru: "Откройте приложение банка", en: "Open your banking app" },
    'atl.pay.s1Sub': { uz: "Click, Payme, Uzum yoki bankingiz — «Kartaga o‘tkazma».", ru: "Click, Payme, Uzum или ваш банк — раздел «Перевод на карту».", en: "Click, Payme, Uzum or your bank — choose “Transfer to card”." },
    'atl.pay.s2': { uz: "Karta va summani qo‘ying", ru: "Вставьте номер карты и сумму", en: "Paste the card and the amount" },
    'atl.pay.s2Sub': { uz: "Nusxa olinganini joylang. Summa aynan {amount}.", ru: "Вставьте скопированное. Сумма — ровно {amount}.", en: "Paste what you copied. The amount is exactly {amount}." },
    'atl.pay.s3': { uz: "Chekni yuklang", ru: "Загрузите чек", en: "Upload the receipt" },
    'atl.pay.s3Sub': { uz: "O‘tkazma chekining skrinshoti, keyin «To‘ladim».", ru: "Скриншот чека о переводе, затем «Оплата отправлена».", en: "A screenshot of the transfer receipt, then “I have paid”." },
    'atl.pay.receipt': { uz: "To‘lov cheki", ru: "Чек об оплате", en: "Payment receipt" },
    'atl.pay.upload': { uz: "Chek skrinshotini yuklash", ru: "Загрузить скриншот чека", en: "Upload a receipt screenshot" },
    'atl.pay.uploadHint': { uz: "PNG yoki JPG, 10 MB gacha", ru: "PNG или JPG, до 10 МБ", en: "PNG or JPG, up to 10 MB" },
    'atl.pay.uploaded': { uz: "{size} · yuklandi", ru: "{size} · загружен", en: "{size} · uploaded" },
    'atl.pay.removeReceipt': { uz: "Chekni o‘chirish", ru: "Удалить чек", en: "Remove receipt" },
    'atl.pay.paid': { uz: "To‘ladim", ru: "Оплата отправлена", en: "I have paid" },
    'atl.pay.needReceipt': { uz: "Chek majburiy: «To‘ladim» u yuklangandan keyin yoqiladi.", ru: "Чек обязателен: кнопка «Оплата отправлена» включится после его загрузки.", en: "A receipt is required: “I have paid” turns on once it is uploaded." },
    'atl.pay.receiptOk': { uz: "Chek yuklandi", ru: "Чек загружен", en: "Receipt uploaded" },
    'atl.pay.receiptNeeded': { uz: "Chek kerak", ru: "Нужен чек", en: "Receipt needed" },
    'atl.pay.errType': { uz: "Faqat PNG yoki JPG rasm yuklang.", ru: "Загрузите изображение PNG или JPG.", en: "Upload a PNG or JPG image." },
    'atl.pay.errSize': { uz: "Fayl juda katta: 10 MB gacha bo‘lsin.", ru: "Файл слишком большой: максимум 10 МБ.", en: "The file is too big: 10 MB at most." },
    'atl.pay.errUpload': { uz: "Chekni yuklab bo‘lmadi. Qayta urinib ko‘ring.", ru: "Не удалось загрузить чек. Попробуйте ещё раз.", en: "Could not upload the receipt. Please try again." },
    'atl.pay.errRate': { uz: "Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.", ru: "Слишком много попыток. Попробуйте снова через несколько минут.", en: "Too many attempts. Try again in a few minutes." },
    'atl.pay.expiredT': { uz: "To‘lov vaqti tugadi", ru: "Время на оплату вышло", en: "Payment time is up" },
    'atl.pay.expiredL': { uz: "Buyurtma {order} uchun 30 daqiqa ichida chek kelmadi, shuning uchun u bekor qilindi. Pulni o‘tkazgan bo‘lsangiz, chekni baribir yuboring — xodimimiz tekshirib, buyurtmani tiklaydi.", ru: "По заказу {order} чек не пришёл за 30 минут, поэтому заказ отменён. Если вы уже перевели деньги, всё равно отправьте чек — сотрудник проверит его и восстановит заказ.", en: "No receipt arrived for order {order} within 30 minutes, so it was cancelled. If you already sent the money, send the receipt anyway — our team checks it and restores the order." },
    'atl.pay.sendReceipt': { uz: "Chekni yuborish", ru: "Отправить чек", en: "Send the receipt" },
    'atl.pay.reorder': { uz: "Qayta buyurtma berish", ru: "Оформить заново", en: "Order again" },
    // Receipt sent: payment being checked
    'atl.placed.title': { uz: "Buyurtma", ru: "Заказ", en: "Order" },
    'atl.placed.h1': { uz: "To‘lov tekshirilmoqda", ru: "Проверяем оплату", en: "Checking your payment" },
    'atl.placed.leadHtml': { uz: "Buyurtma <b>{order}</b>, {amount}. Chekni oldik. Xodimimiz to‘lovni qo‘lda tekshiradi — ish vaqtida 30 daqiqa ichida. Natija Telegramga keladi, ishlab chiqarish faqat tasdiqdan keyin boshlanadi.", ru: "Заказ <b>{order}</b>, {amount}. Чек получили. Сотрудник проверит оплату вручную — в рабочее время в течение 30 минут. Результат придёт в Telegram, производство начнём только после подтверждения.", en: "Order <b>{order}</b>, {amount}. We have your receipt. Our team checks the payment by hand — within 30 minutes during working hours. The result comes to Telegram, and production starts only after confirmation." },
    'atl.placed.sent': { uz: "Chek yuborildi", ru: "Чек отправлен", en: "Receipt sent" },
    'atl.placed.checking': { uz: "To‘lov tekshirilmoqda", ru: "Проверяем оплату", en: "Checking the payment" },
    'atl.placed.checkingSub': { uz: "Xodim summa va chekni solishtiradi, 30 daqiqagacha", ru: "Сотрудник сверяет сумму с чеком, до 30 минут", en: "Our team matches the amount with the receipt, up to 30 minutes" },
    'atl.placed.production': { uz: "Ishlab chiqarish", ru: "Производство", en: "Production" },
    'atl.placed.productionSub': { uz: "To‘lov tasdiqlangach, 1–2 kun", ru: "После подтверждения оплаты, 1–2 дня", en: "After payment is confirmed, 1–2 days" },
    'atl.placed.delivery': { uz: "Yetkazish", ru: "Доставка", en: "Delivery" },
    'atl.placed.deliverySub': { uz: "Toshkentda 2–4 ish kuni", ru: "По Ташкенту 2–4 рабочих дня", en: "2–4 working days in Tashkent" },
    'atl.placed.track': { uz: "Buyurtmani kuzatish", ru: "Отследить заказ", en: "Track the order" },
    'atl.placed.backCatalog': { uz: "Katalogga qaytish", ru: "Вернуться в каталог", en: "Back to the catalogue" },
    'atl.placed.catalogShort': { uz: "Katalogga", ru: "В каталог", en: "Catalogue" },
    // Order status pills (word, never colour alone)
    'atl.st.awaiting': { uz: "To‘lov kutilmoqda", ru: "Ждёт оплаты", en: "Awaiting payment" },
    'atl.st.review': { uz: "To‘lov tekshirilmoqda", ru: "Оплата на проверке", en: "Payment being checked" },
    'atl.st.rejected': { uz: "To‘lov topilmadi", ru: "Оплата не найдена", en: "Payment not found" },
    'atl.st.paid': { uz: "To‘lov tasdiqlandi", ru: "Оплата подтверждена", en: "Payment confirmed" },
    'atl.st.production': { uz: "Ishlab chiqarishda", ru: "В производстве", en: "In production" },
    'atl.st.shipped': { uz: "Yo‘lda", ru: "В пути", en: "On the way" },
    'atl.st.delivered': { uz: "Yetkazildi", ru: "Доставлен", en: "Delivered" },
    'atl.st.cancelled': { uz: "Bekor qilindi", ru: "Отменён", en: "Cancelled" },
    // Orders list and order detail
    'atl.orders.title': { uz: "Buyurtmalarim", ru: "Мои заказы", en: "My orders" },
    'atl.orders.active': { uz: "Faol", ru: "Активные", en: "Active" },
    'atl.orders.done': { uz: "Yakunlangan", ru: "Завершённые", en: "Completed" },
    'atl.orders.empty': { uz: "Hali buyurtma yo‘q", ru: "Заказов пока нет", en: "No orders yet" },
    'atl.orders.emptyLead': { uz: "Birinchi kiyimingizni yarating — buyurtma holati shu yerda ko‘rinadi.", ru: "Создайте первую вещь — статус заказа появится здесь.", en: "Create your first garment — its order status shows up here." },
    'atl.orders.payWithin': { uz: "{min} daqiqa ichida to‘lang", ru: "Оплатите в течение {min} мин", en: "Pay within {min} min" },
    'atl.od.h1': { uz: "Buyurtma {order}", ru: "Заказ {order}", en: "Order {order}" },
    'atl.od.paidSub': { uz: "Kartaga tushdi", ru: "Деньги поступили на карту", en: "The money has arrived" },
    'atl.od.shippedSub': { uz: "Kuryer qo‘ng‘iroq qiladi", ru: "Курьер позвонит", en: "The courier will call you" },
    'atl.od.checkingSub': { uz: "Xodim tekshiryapti, ish vaqtida 30 daqiqagacha", ru: "Сотрудник проверяет, в рабочее время до 30 минут", en: "Our team is checking, up to 30 minutes during working hours" },
    'atl.od.mismatchSub': { uz: "Summa mos kelmadi", ru: "Сумма не совпала", en: "The amount did not match" },
    'atl.od.rejectAmounts': { uz: "To‘lov topilmadi. Chekdagi summa {paid}, buyurtma {total}. {diff} farqni o‘tkazib, yangi chek yuklang yoki bizga yozing.", ru: "Оплата не найдена. В чеке {paid}, а заказ на {total}. Переведите разницу {diff} и загрузите новый чек или напишите нам.", en: "Payment not found. The receipt shows {paid}, the order is {total}. Transfer the difference of {diff} and upload a new receipt, or write to us." },
    // Not in the mockup: the two reject reasons the admin can pick (plan 1.3). Uzbek written here, flag for review.
    'atl.od.rejectNotFound': { uz: "To‘lov topilmadi: chekdagi o‘tkazma kartamizga kelmagan. Yangi chek yuklang yoki bizga yozing.", ru: "Оплата не найдена: перевод из чека не поступил на нашу карту. Загрузите новый чек или напишите нам.", en: "Payment not found: the transfer on the receipt has not reached our card. Upload a new receipt or write to us." },
    'atl.od.rejectMismatch': { uz: "Summa mos kelmadi: chekdagi summa buyurtma summasiga teng emas. Farqni o‘tkazib, yangi chek yuklang yoki bizga yozing.", ru: "Сумма не совпала: в чеке не та сумма, что в заказе. Переведите разницу и загрузите новый чек или напишите нам.", en: "The amount does not match: the receipt shows a different sum than the order. Transfer the difference and upload a new receipt, or write to us." },
    'atl.od.notFoundT': { uz: "Buyurtma topilmadi", ru: "Заказ не найден", en: "Order not found" },
    'atl.od.notFoundL': { uz: "Bunday buyurtma yo‘q yoki u boshqa akkauntga tegishli. Buyurtmalaringiz ro‘yxatini oching.", ru: "Такого заказа нет или он относится к другому аккаунту. Откройте список своих заказов.", en: "This order does not exist or belongs to another account. Open your list of orders." },
    'atl.od.newReceipt': { uz: "Yangi chek yuklash", ru: "Загрузить новый чек", en: "Upload a new receipt" },
    'atl.od.writeSupport': { uz: "Yordamga yozish", ru: "Написать в поддержку", en: "Contact support" },
    'atl.od.payChecking': { uz: "tekshirilmoqda", ru: "на проверке", en: "being checked" },
    'atl.od.payNotFound': { uz: "topilmadi", ru: "не найдена", en: "not found" },
    'atl.od.payPaid': { uz: "to‘langan", ru: "оплачено", en: "paid" },
    'atl.od.question': { uz: "Savol bormi?", ru: "Есть вопрос?", en: "Have a question?" },
    'atl.od.cancelWrite': { uz: "Bekor qilish uchun yozish", ru: "Написать, чтобы отменить", en: "Write to us to cancel" },
    // Account
    'atl.acc.signIn': { uz: "Kiring", ru: "Войдите", en: "Sign in" },
    'atl.acc.signInLead': { uz: "Buyurtmalarni kuzatish, manzillarni saqlash uchun. Raqamingiz Telegram orqali tasdiqlanadi.", ru: "Чтобы следить за заказами и сохранять адреса. Номер подтверждается через Telegram.", en: "To track orders and save addresses. Your number is confirmed through Telegram." },
    'atl.acc.signInBtn': { uz: "Kirish", ru: "Войти", en: "Sign in" },
    'atl.acc.lang': { uz: "Til", ru: "Язык", en: "Language" },
    'atl.acc.theme': { uz: "Mavzu", ru: "Тема", en: "Theme" },
    'atl.acc.viaTg': { uz: "Telegram orqali", ru: "через Telegram", en: "via Telegram" },
    'atl.acc.grpOrders': { uz: "Buyurtmalar", ru: "Заказы", en: "Orders" },
    'atl.acc.ordersSub': { uz: "{unpaid} ta to‘lanmagan, {review} ta tekshiruvda", ru: "Не оплачено: {unpaid}, на проверке: {review}", en: "{unpaid} unpaid, {review} being checked" },
    'atl.acc.grpAccount': { uz: "Akkaunt", ru: "Аккаунт", en: "Account" },
    'atl.acc.profile': { uz: "Profil", ru: "Профиль", en: "Profile" },
    'atl.acc.profileSub': { uz: "Ism va familiya", ru: "Имя и фамилия", en: "First and last name" },
    'atl.acc.phone': { uz: "Telefon raqami", ru: "Номер телефона", en: "Phone number" },
    'atl.acc.addresses': { uz: "Manzillar", ru: "Адреса", en: "Addresses" },
    'atl.acc.addrCount': { uz: "{n} ta", ru: "{n}", en: "{n}" },
    'atl.acc.grpApp': { uz: "Ilova", ru: "Настройки", en: "Settings" },
    'atl.acc.notifications': { uz: "Bildirishnomalar", ru: "Уведомления", en: "Notifications" },
    'atl.acc.privacy': { uz: "Maxfiylik", ru: "Конфиденциальность", en: "Privacy" },
    'atl.acc.grpOther': { uz: "Boshqa", ru: "Другое", en: "More" },
    'atl.acc.becomeDesigner': { uz: "Dizayner bo‘lish", ru: "Стать дизайнером", en: "Become a designer" },
    'atl.acc.becomeSub': { uz: "Ishlaringizni marketda soting", ru: "Продавайте свои работы в маркете", en: "Sell your work in the market" },
    'atl.acc.logout': { uz: "Chiqish", ru: "Выйти", en: "Sign out" },
    'atl.acc.delete': { uz: "Akkauntni o‘chirish", ru: "Удалить аккаунт", en: "Delete account" },
    'atl.acc.name': { uz: "Ism", ru: "Имя", en: "First name" },
    'atl.acc.surname': { uz: "Familiya", ru: "Фамилия", en: "Last name" },
    'atl.acc.nameHint': { uz: "Buyurtmada va kuryer uchun shu ism ko‘rsatiladi.", ru: "Это имя будет в заказе и у курьера.", en: "This name appears on your order and for the courier." },
    'atl.acc.newNum': { uz: "Yangi raqam", ru: "Новый номер", en: "New number" },
    'atl.acc.newNumHint': { uz: "Yangi raqamni Telegram orqali tasdiqlaysiz. Tasdiqlanmaguncha eski raqam ishlaydi.", ru: "Новый номер подтвердите через Telegram. До подтверждения работает старый.", en: "You confirm the new number through Telegram. Until then the old one keeps working." },
    'atl.acc.tgVerified': { uz: "Telegram orqali tasdiqlangan", ru: "Подтверждён через Telegram", en: "Confirmed through Telegram" },
    'atl.acc.addrLabel': { uz: "Nomi", ru: "Название", en: "Label" },
    'atl.acc.addrLabelPh': { uz: "Uy, Ish…", ru: "Дом, Работа…", en: "Home, Work…" },
    'atl.acc.saveAddr': { uz: "Manzilni saqlash", ru: "Сохранить адрес", en: "Save address" },
    'atl.acc.addrMain': { uz: "Asosiy", ru: "Основной", en: "Default" },
    'atl.acc.phoneChange': { uz: "Raqamni o‘zgartirish uchun @looom_design_bot ga yozing.", ru: "Чтобы сменить номер, напишите @looom_design_bot.", en: "To change your number, message @looom_design_bot." },
    'atl.acc.addrNone': { uz: "Saqlangan manzil yo‘q. Uni qo‘shsangiz, buyurtmada tanlash kifoya.", ru: "Сохранённого адреса нет. Добавьте его — при заказе останется только выбрать.", en: "No saved address. Add one and just pick it at checkout." },
    'atl.acc.needAddr': { uz: "Manzilni kiriting", ru: "Укажите адрес", en: "Enter the address" },
    'atl.acc.addAddr': { uz: "Manzil qo‘shish", ru: "Добавить адрес", en: "Add an address" },
    'atl.acc.notifOrder': { uz: "Buyurtma holati", ru: "Статус заказа", en: "Order status" },
    'atl.acc.notifOrderSub': { uz: "Buyurtmangiz yangi bosqichga o‘tganda", ru: "Когда заказ переходит на новый этап", en: "When your order moves to the next stage" },
    'atl.acc.notifPromo': { uz: "Aksiya va yangiliklar", ru: "Акции и новости", en: "Offers and news" },
    'atl.acc.notifPromoSub': { uz: "Yangi mahsulotlar va maxsus takliflar", ru: "Новые товары и специальные предложения", en: "New products and special offers" },
    'atl.acc.notifHint': { uz: "Xabarlar Telegramda @looom_design_bot orqali keladi.", ru: "Сообщения приходят в Telegram от @looom_design_bot.", en: "Messages come in Telegram from @looom_design_bot." },
    'atl.acc.analytics': { uz: "Analitika cookie", ru: "Аналитические cookie", en: "Analytics cookies" },
    'atl.acc.analyticsSub': { uz: "Google Analytics, Microsoft Clarity, Yandex Metrika. Ism, telefon va manzil ularga yuborilmaydi.", ru: "Google Analytics, Microsoft Clarity, Яндекс Метрика. Имя, телефон и адрес им не передаются.", en: "Google Analytics, Microsoft Clarity, Yandex Metrica. Your name, phone and address are never sent to them." },
    'atl.acc.dataCopy': { uz: "Ma’lumotlarim nusxasi", ru: "Копия моих данных", en: "A copy of my data" },
    'atl.acc.dataCopySub': { uz: "@looom_design_bot orqali so‘rang", ru: "Запросите через @looom_design_bot", en: "Ask through @looom_design_bot" },
    'atl.acc.policy': { uz: "Maxfiylik siyosati", ru: "Политика конфиденциальности", en: "Privacy policy" },
    'atl.acc.delLead': { uz: "Profil, manzil va yuklangan fayllar butunlay o‘chiriladi.", ru: "Профиль, адреса и загруженные файлы будут удалены навсегда.", en: "Your profile, addresses and uploaded files are deleted for good." },
    'atl.acc.delErased': { uz: "O‘chiriladi", ru: "Удаляется", en: "Deleted" },
    'atl.acc.delE1': { uz: "Ism, telefon, foto va manzillar", ru: "Имя, телефон, фото и адреса", en: "Name, phone, photo and addresses" },
    'atl.acc.delE2': { uz: "Telegram, Google va Discord bog‘lanishlari", ru: "Привязки Telegram, Google и Discord", en: "Telegram, Google and Discord links" },
    'atl.acc.delE3': { uz: "Moderatsiyadagi nashr qilinmagan ishlar", ru: "Неопубликованные работы на модерации", en: "Unpublished works waiting for moderation" },
    'atl.acc.delKept': { uz: "Saqlanadi", ru: "Сохраняется", en: "Kept" },
    'atl.acc.delKeptSub': { uz: "Buyurtmalar yozuvi shaxsingizsiz holda — buxgalteriya hisobi uchun.", ru: "Записи о заказах — без ваших личных данных, для бухгалтерии.", en: "Order records, without your personal details, for accounting." },
    'atl.acc.delActive': { uz: "Sizda faol buyurtma bor: {orders}. Akkaunt yetkazib berilgandan keyin o‘chiriladi.", ru: "У вас есть незавершённый заказ: {orders}. Аккаунт удалим после доставки.", en: "You have an order in progress: {orders}. We delete the account after it is delivered." },
    'atl.acc.delAfter': { uz: "Yetkazilgandan keyin o‘chirish", ru: "Удалить после доставки", en: "Delete after delivery" },
    'atl.acc.delWarn': { uz: "Bu amalni bekor qilib bo‘lmaydi. Tasdiqlash uchun yana bosing.", ru: "Это действие нельзя отменить. Нажмите ещё раз, чтобы подтвердить.", en: "This cannot be undone. Tap again to confirm." },
    'atl.acc.delConfirm': { uz: "Ha, butunlay o‘chirilsin", ru: "Да, удалить навсегда", en: "Yes, delete it for good" },
    'atl.acc.delScheduled': { uz: "O‘chirish rejalashtirildi. {orders} yetkazilgach akkaunt o‘chiriladi, sizga Telegramda xabar keladi. Ungacha fikringizni o‘zgartirsangiz bo‘ladi.", ru: "Удаление запланировано. Аккаунт удалим после доставки {orders} и напишем вам в Telegram. До этого можно передумать.", en: "Deletion is scheduled. We delete the account once {orders} is delivered and tell you in Telegram. Until then you can change your mind." },
    'atl.acc.delUndo': { uz: "O‘chirishni bekor qilish", ru: "Отменить удаление", en: "Cancel deletion" },
    // Market, designers, Lab
    'atl.mkt.lead': { uz: "Mustaqil dizaynerlarning ishlari. Printni tanlang — u konstruktorda ochiladi, muallif har sotuvdan ulush oladi.", ru: "Работы независимых дизайнеров. Выберите принт — он откроется в конструкторе, а автор получит долю с каждой продажи.", en: "Work by independent designers. Pick a print — it opens in the designer, and the author earns a share of every sale." },
    'atl.mkt.emptyT': { uz: "Hozircha bo‘sh. Birinchi bo‘ling.", ru: "Пока пусто. Станьте первым.", en: "Empty for now. Be the first." },
    'atl.mkt.emptyL': { uz: "Ishingizni yuklang — tekshiramiz, shu yerda ko‘rsatamiz, har sotuvdan ustamangizning 70% sizga.", ru: "Загрузите работу — мы проверим её и покажем здесь. С каждой продажи вам достаётся 70% вашей наценки.", en: "Upload your work — we review it and show it here. You get 70% of your markup on every sale." },
    'atl.dsg.lead': { uz: "Printlarni o‘ylab topadigan odamlar. Ishlari tekshiruvdan o‘tgan va marketda sotiladi.", ru: "Люди, которые придумывают принты. Их работы прошли проверку и продаются в маркете.", en: "The people who come up with the prints. Their work is reviewed and sold in the market." },
    'atl.dsg.b1': { uz: "Nik o‘ylab toping", ru: "Придумайте ник", en: "Choose a handle" },
    'atl.dsg.b1Sub': { uz: "Xaridorlar ishlaringizni shu nom ostida ko‘radi.", ru: "Под этим именем покупатели увидят ваши работы.", en: "Buyers see your work under this name." },
    'atl.dsg.b2': { uz: "Fayl va ustama", ru: "Файл и наценка", en: "File and markup" },
    'atl.dsg.b2Sub': { uz: "PNG, shaffof fon, uzun tomoni kamida 1500 px.", ru: "PNG с прозрачным фоном, длинная сторона от 1500 px.", en: "PNG with a transparent background, at least 1500 px on the long side." },
    'atl.dsg.b3': { uz: "Tekshiruv", ru: "Проверка", en: "Review" },
    'atl.dsg.b3Sub': { uz: "Odatda 1–2 kun, keyin marketda chiqadi.", ru: "Обычно 1–2 дня, потом работа появится в маркете.", en: "Usually 1–2 days, then it appears in the market." },
    'atl.lab.h1': { uz: "So‘z bilan tasvirlang. Ustingizga kiying.", ru: "Опишите словами. Наденьте на себя.", en: "Describe it in words. Then wear it." },
    'atl.lab.lead': { uz: "Lab — konstruktor ichidagi print generatori. G‘oyani oddiy gap bilan yozasiz, Lab chizadi, fonini olib tashlaydi va bosmaga tayyor faylni beradi.", ru: "Lab — генератор принтов внутри конструктора. Вы описываете идею обычной фразой, Lab рисует её, убирает фон и отдаёт файл, готовый к печати.", en: "Lab is a print generator inside the designer. You describe an idea in a plain sentence; Lab draws it, removes the background and hands you a print-ready file." },
    'atl.lab.f1': { uz: "Rasm yaratish", ru: "Создание изображения", en: "Image generation" },
    'atl.lab.f2': { uz: "Fonni avtomatik olib tashlash", ru: "Автоматическое удаление фона", en: "Automatic background removal" },
    'atl.lab.f3': { uz: "Foydalanuvchi limitlari", ru: "Лимиты для пользователей", en: "User limits" },
    'atl.lab.f4': { uz: "Bosmadan oldin tekshiruv", ru: "Проверка перед печатью", en: "Pre-print check" },
    'atl.lab.f5': { uz: "Konstruktordagi tugma", ru: "Кнопка в конструкторе", en: "Button in the designer" },
    'atl.lab.ready': { uz: "Tayyor", ru: "Готово", en: "Ready" },
    'atl.lab.wip': { uz: "Ishlanmoqda", ru: "В работе", en: "In progress" },
    'atl.lab.next': { uz: "Keyingi qadam", ru: "Следующий шаг", en: "Next step" },
    'atl.lab.toCfg': { uz: "Konstruktorga", ru: "В конструктор", en: "To the designer" },
    // Help / FAQ
    'atl.help.title': { uz: "Yordam", ru: "Помощь", en: "Help" },
    'atl.help.q1': { uz: "Qancha vaqtda yetkazasiz?", ru: "Как быстро вы доставляете?", en: "How fast do you deliver?" },
    'atl.help.a1': { uz: "Toshkentda ishlab chiqarishdan keyin 2–4 ish kuni, yetkazish 30 000 so‘m. Viloyatlarga muddat va narx buyurtmani tasdiqlashda aytiladi.", ru: "По Ташкенту — 2–4 рабочих дня после производства, доставка 30 000 сум. Сроки и цену для регионов сообщим при подтверждении заказа.", en: "In Tashkent, 2–4 working days after production; delivery is 30 000 UZS. For the regions we tell you the time and price when we confirm the order." },
    'atl.help.q2': { uz: "Qanday to‘layman?", ru: "Как оплатить?", en: "How do I pay?" },
    'atl.help.a2': { uz: "Buyurtmani oldindan, to‘liq to‘laysiz: LOOM kartasiga o‘tkazma. Karta raqami va aniq summa to‘lov sahifasida chiqadi. 30 daqiqa ichida o‘tkazib, chek skrinshotini yuklaysiz — chek majburiy. Payme, Click va Uzum Bank tez orada.", ru: "Заказ оплачивается заранее и полностью — переводом на карту LOOM. Номер карты и точная сумма будут на странице оплаты. Переведите деньги в течение 30 минут и загрузите скриншот чека — без чека никак. Payme, Click и Uzum Bank появятся скоро.", en: "You pay for the order upfront and in full, by transfer to the LOOM card. The card number and exact amount are on the payment page. Transfer within 30 minutes and upload a screenshot of the receipt — the receipt is required. Payme, Click and Uzum Bank are coming soon." },
    'atl.help.q3': { uz: "To‘lov qachon tasdiqlanadi?", ru: "Когда подтвердят оплату?", en: "When is my payment confirmed?" },
    'atl.help.a3': { uz: "Xodimimiz chekni qo‘lda tekshiradi: ish vaqtida ({hours}) 30 daqiqa ichida. Natija Telegramga keladi; ishlab chiqarish faqat tasdiqdan keyin boshlanadi.", ru: "Сотрудник проверяет чек вручную — в рабочее время ({hours}) в течение 30 минут. Результат придёт в Telegram; производство начинается только после подтверждения.", en: "Our team checks the receipt by hand, within 30 minutes during working hours ({hours}). The result comes to Telegram, and production starts only after confirmation." },
    'atl.help.q4': { uz: "30 daqiqada ulgurmasam-chi?", ru: "А если я не успею за 30 минут?", en: "What if I miss the 30 minutes?" },
    'atl.help.a4': { uz: "5 daqiqa qolganda Telegramga eslatma keladi. Vaqt tugasa, buyurtma bekor bo‘ladi. Pulni o‘tkazgan bo‘lsangiz, chekni baribir yuboring — tekshirib, buyurtmani tiklaymiz.", ru: "За 5 минут до конца придёт напоминание в Telegram. Когда время выйдет, заказ отменится. Если вы уже перевели деньги, всё равно отправьте чек — мы проверим и восстановим заказ.", en: "With 5 minutes left you get a reminder in Telegram. When time runs out, the order is cancelled. If you already sent the money, send the receipt anyway — we check it and restore the order." },
    'atl.help.q5': { uz: "Buyurtmani bekor qilsa bo‘ladimi?", ru: "Можно отменить заказ?", en: "Can I cancel my order?" },
    'atl.help.a5': { uz: "Ha, «Ishlab chiqarish» bosqichigacha. @looom_design_bot ga yozing — to‘langan summani qaytarish tartibini shu yerda kelishamiz.", ru: "Да, до этапа «Производство». Напишите @looom_design_bot — там договоримся, как вернуть оплату.", en: "Yes, until the “Production” stage. Write to @looom_design_bot and we agree there how to refund your payment." },
    'atl.help.q6': { uz: "Qaytarish mumkinmi?", ru: "Можно вернуть вещь?", en: "Can I return an item?" },
    'atl.help.a6': { uz: "Printli kiyim siz uchun tayyorlanadi, shuning uchun faqat ishlab chiqarish nuqsoni yoki tasdiqlangan maketga mos kelmasa almashtiramiz. Printsiz kiyimni 14 kun ichida qaytarish mumkin.", ru: "Вещь с принтом делается специально для вас, поэтому мы заменим её, только если есть производственный брак или она не совпадает с утверждённым макетом. Вещь без принта можно вернуть в течение 14 дней.", en: "A printed garment is made just for you, so we replace it only if it has a production defect or does not match the approved mockup. Blank garments can be returned within 14 days." },
    'atl.help.q7': { uz: "Qanday rasm yuklasam bo‘ladi?", ru: "Какие картинки можно загрузить?", en: "What images can I upload?" },
    'atl.help.a7': { uz: "PNG, JPG yoki HEIC, 15 MB gacha. Bosma maydoni 30 × 40 sm. Rasmdan foydalanish huquqingiz bo‘lishi kerak.", ru: "PNG, JPG или HEIC, до 15 МБ. Область печати 30 × 40 см. У вас должно быть право использовать изображение.", en: "PNG, JPG or HEIC, up to 15 MB. The print area is 30 × 40 cm. You must have the right to use the image." },
    'atl.help.q8': { uz: "Ranglar ekrandagidek chiqadimi?", ru: "Цвета будут как на экране?", en: "Will the colours match the screen?" },
    'atl.help.a8': { uz: "Matoga bosishda odatiy kichik farq bo‘lishi mumkin.", ru: "При печати на ткани возможна небольшая разница — это нормально.", en: "Printing on fabric can differ slightly from the screen, which is normal." },
    'atl.help.noAnswer': { uz: "Javob topmadingizmi?", ru: "Не нашли ответа?", en: "Didn’t find an answer?" },
    'atl.help.noAnswerSub': { uz: "Telegram: @looom_design_bot — ish vaqtida tez javob beramiz", ru: "Telegram: @looom_design_bot — в рабочее время отвечаем быстро", en: "Telegram: @looom_design_bot — we reply fast during working hours" },
    // Legal page frame (body text stays in privacy.html)
    'atl.legal.title': { uz: "Shartlar va maxfiylik", ru: "Условия и конфиденциальность", en: "Terms and privacy" },
    'atl.legal.edition': { uz: "{date} tahriri · loomdesign.uz va LOOM ilovasi", ru: "Редакция от {date} · loomdesign.uz и приложение LOOM", en: "Version of {date} · loomdesign.uz and the LOOM app" },
    'atl.legal.s1': { uz: "Maxfiylik siyosati", ru: "Политика конфиденциальности", en: "Privacy policy" },
    'atl.legal.s2': { uz: "Analitika va cookie", ru: "Аналитика и cookie", en: "Analytics and cookies" },
    'atl.legal.s3': { uz: "Buyurtma shartlari", ru: "Условия заказа", en: "Order terms" },
    'atl.legal.s4': { uz: "Yetkazib berish va to‘lov", ru: "Доставка и оплата", en: "Delivery and payment" },
    'atl.legal.s5': { uz: "Dizaynerlarga", ru: "Дизайнерам", en: "For designers" },
    'atl.legal.s6': { uz: "Akkauntni o‘chirish", ru: "Удаление аккаунта", en: "Deleting your account" },
    'atl.legal.s7': { uz: "Mualliflar (Credits)", ru: "Авторы (Credits)", en: "Credits" },
    'atl.legal.toc': { uz: "Bo‘limlar", ru: "Разделы", en: "Sections" },
    'atl.legal.consentChange': { uz: "Tanlovni o‘zgartirish", ru: "Изменить выбор", en: "Change my choice" },
    'atl.legal.langNote': { uz: "Matn o‘zbek va rus tillarida. Ikkala tahrir teng kuchga ega.", ru: "Текст на узбекском и русском языках. Обе редакции равнозначны.", en: "The terms are published in Uzbek and Russian; both versions are equally valid. The English page shows the Uzbek text." },
    'atl.legal.questions': { uz: "Shartlar va ma’lumotlar bo‘yicha savollar: Telegram @looom_design_bot, sayt loomdesign.uz.", ru: "Вопросы по этим условиям и данным: Telegram @looom_design_bot, сайт loomdesign.uz.", en: "Questions about these terms and your data: Telegram @looom_design_bot, website loomdesign.uz." },
    // 404 and page states
    'atl.nf.title': { uz: "Sahifa so‘kilib ketdi.", ru: "Страница распустилась.", en: "This page came apart." },
    'atl.nf.lead': { uz: "Bunday sahifa yo‘q — u olib tashlangan bo‘lishi yoki havolada xato bo‘lishi mumkin. Konstruktor esa joyida.", ru: "Такой страницы нет — её могли убрать, или в ссылке опечатка. Зато конструктор на месте.", en: "There is no page at this address — it may have been removed, or the link has a typo. The designer is still here." },
    'atl.state.errT': { uz: "Nimadir noto‘g‘ri ketdi", ru: "Что-то пошло не так", en: "Something went wrong" },
    'atl.state.errL': { uz: "Sahifani yuklab bo‘lmadi. Internetni tekshirib, yangilang.", ru: "Не удалось загрузить страницу. Проверьте интернет и обновите её.", en: "The page could not load. Check your connection and reload." },
    'atl.state.offline': { uz: "Internet yo‘q. Ko‘rib turganingiz saqlanadi; ulanishi bilan davom etamiz.", ru: "Нет интернета. То, что на экране, сохранится; продолжим, как только связь вернётся.", en: "No internet. What you see stays here; we carry on as soon as you are back online." },
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

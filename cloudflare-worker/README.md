# LOOM Telegram Orders - Cloudflare Worker

Cloudflare Worker для отправки заказов из конфигуратора футболок LOOM в Telegram.

## 🚀 Быстрая установка

### Шаг 1: Установите Wrangler CLI

```bash
npm install -g wrangler
```

### Шаг 2: Авторизуйтесь в Cloudflare

```bash
wrangler login
```

### Шаг 3: Получите НОВЫЙ токен бота

⚠️ **ВАЖНО**: Ваш старый токен скомпрометирован! Получите новый:

1. Откройте Telegram и найдите [@BotFather](https://t.me/BotFather)
2. Отправьте `/revoke` и выберите вашего бота (чтобы отозвать старый токен)
3. Отправьте `/token` и выберите вашего бота для получения нового токена
4. Сохраните новый токен в безопасном месте

### Шаг 4: Получите Chat ID

Чтобы узнать Chat ID:

**Вариант A - для личного чата:**

1. Напишите что-нибудь вашему боту в Telegram
2. Откройте в браузере: `https://api.telegram.org/bot<НОВЫЙ_ТОКЕН>/getUpdates`
3. Найдите `"chat":{"id":ЧИСЛО}` - это ваш Chat ID

**Вариант B - для группы:**

1. Добавьте бота в группу
2. Напишите что-нибудь в группе
3. Откройте: `https://api.telegram.org/bot<НОВЫЙ_ТОКЕН>/getUpdates`
4. Chat ID группы будет отрицательным числом (например: -1001234567890)

### Шаг 5: Добавьте секреты в Worker

```bash
cd cloudflare-worker

# Добавить токен бота
wrangler secret put TELEGRAM_BOT_TOKEN
# Вставьте новый токен и нажмите Enter

# Добавить Chat ID
wrangler secret put TELEGRAM_CHAT_ID
# Вставьте Chat ID и нажмите Enter
```

### Шаг 6: Разверните Worker

```bash
npm install
wrangler deploy
```

После деплоя вы получите URL типа:
`https://loom-telegram-orders.YOUR_SUBDOMAIN.workers.dev`

### Шаг 7: Обновите URL в конфигураторе

Замените старый URL в `configurator.html`:

```javascript
// Было:
const response = await fetch(
  "https://d1-template.timurnasriddinov56.workers.dev",
  ...
);

// Стало (замените на ваш новый URL):
const response = await fetch(
  "https://loom-telegram-orders.YOUR_SUBDOMAIN.workers.dev",
  ...
);
```

## 🧪 Тестирование

### Проверка работы Worker

```bash
# Health check
curl https://loom-telegram-orders.YOUR_SUBDOMAIN.workers.dev

# Тестовый заказ
curl -X POST https://loom-telegram-orders.YOUR_SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Тест Тестов",
    "phone": "+998 90 123-45-67",
    "item": "Футболка Oversized",
    "color": "Белый",
    "size": "L",
    "text": "Тестовый текст",
    "address": "Ташкент, ул. Тестовая"
  }'
```

### Проверка через консоль браузера

В конфигураторе откройте консоль (F12) и выполните:

```javascript
testTelegramConnection();
```

## 📁 Структура файлов

```
cloudflare-worker/
├── package.json        # Зависимости и скрипты
├── wrangler.toml       # Конфигурация Cloudflare Worker
├── src/
│   └── worker.js       # Основной код Worker
└── README.md           # Эта документация
```

## 🔧 Команды

```bash
# Локальная разработка
npm run dev

# Деплой в production
npm run deploy

# Просмотр логов в реальном времени
npm run tail

# Добавить секреты
npm run secrets
```

## 🔒 Безопасность

- ✅ Токены хранятся как секреты (не в коде)
- ✅ CORS настроен для разрешённых доменов
- ✅ Валидация входных данных
- ✅ Санитизация для предотвращения инъекций
- ✅ Ограничение размера сообщений и файлов

## 🐛 Устранение неполадок

### "Load failed" / "Failed to fetch"

1. Проверьте, что Worker развёрнут: откройте URL в браузере
2. Проверьте CORS - добавьте ваш домен в `ALLOWED_ORIGINS` в wrangler.toml
3. Проверьте консоль браузера для деталей ошибки

### "Server configuration error: Missing bot token"

Секреты не добавлены. Выполните:

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

### Сообщения не приходят в Telegram

1. Проверьте правильность Chat ID
2. Убедитесь, что бот добавлен в чат/группу
3. Для групп - сделайте бота администратором
4. Проверьте логи: `wrangler tail`

## 📞 Поддержка

При возникновении проблем проверьте:

1. Логи Worker: `wrangler tail`
2. Консоль браузера (F12)
3. Правильность всех URL и токенов

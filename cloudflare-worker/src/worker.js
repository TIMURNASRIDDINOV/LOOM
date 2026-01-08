/**
 * LOOM Telegram Orders - Cloudflare Worker
 * Получает заказы и отправляет их в Telegram
 */

const TELEGRAM_API = "https://api.telegram.org/bot";

// Escape HTML для безопасности
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .substring(0, 500);
}

// Форматирование сообщения заказа
function formatOrderMessage(data) {
  const date = new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
  });

  return `
🛍 <b>НОВЫЙ ЗАКАЗ</b>

━━━━━━━━━━━━━━━━━━━━
📦 <b>ТОВАР</b>
━━━━━━━━━━━━━━━━━━━━
▫️ Товар: <b>${escapeHtml(data.item || "Футболка")}</b>
▫️ Цвет: <b>${escapeHtml(data.color || "Не указан")}</b>
▫️ Размер: <b>${escapeHtml(data.size || "M")}</b>

━━━━━━━━━━━━━━━━━━━━
🎨 <b>ДИЗАЙН</b>
━━━━━━━━━━━━━━━━━━━━
▫️ Текст: <code>${escapeHtml(data.text || "Без текста")}</code>
▫️ Шрифт: ${escapeHtml(data.font || "Inter")}
▫️ Масштаб: ${escapeHtml(data.scale || "100%")}
▫️ Изображение: ${escapeHtml(data.imageUploaded || "Нет")}

━━━━━━━━━━━━━━━━━━━━
👤 <b>ПОКУПАТЕЛЬ</b>
━━━━━━━━━━━━━━━━━━━━
▫️ Имя: <b>${escapeHtml(data.customerName || "Не указано")}</b>
▫️ Телефон: <code>${escapeHtml(data.phone || "Не указан")}</code>

━━━━━━━━━━━━━━━━━━━━
📍 <b>ДОСТАВКА</b>
━━━━━━━━━━━━━━━━━━━━
▫️ Адрес: ${escapeHtml(data.address || "Не указан")}
▫️ Координаты: ${escapeHtml(data.mapCoordinates || "Не указаны")}

━━━━━━━━━━━━━━━━━━━━
⏰ ${date}
`.trim();
}

// Отправка сообщения в Telegram
async function sendTelegramMessage(botToken, chatId, message) {
  const url = `${TELEGRAM_API}${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(`Telegram API: ${result.description}`);
  }

  return result;
}

// CORS заголовки
function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// Главный обработчик
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(request, env);

    // Обработка preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          service: "LOOM Telegram Orders",
          status: "running",
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Обработка заказа
    if (request.method === "POST") {
      try {
        // Проверка конфигурации
        if (!env.TELEGRAM_BOT_TOKEN) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "TELEGRAM_BOT_TOKEN not configured",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            }
          );
        }

        if (!env.TELEGRAM_CHAT_ID) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "TELEGRAM_CHAT_ID not configured",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            }
          );
        }

        // Парсинг данных
        const orderData = await request.json();

        // Валидация
        if (!orderData.customerName || !orderData.phone) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "customerName and phone are required",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            }
          );
        }

        // Форматирование и отправка
        const message = formatOrderMessage(orderData);
        const result = await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          env.TELEGRAM_CHAT_ID,
          message
        );

        return new Response(
          JSON.stringify({
            success: true,
            message: "Order sent to Telegram",
            messageId: result.result?.message_id,
          }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      } catch (error) {
        console.error("Error:", error);
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message || "Internal error",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  },
};

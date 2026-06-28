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

  // Helper: format position coords as "x, y px"
  const pos = (x, y) => (x || y) ? `(${x || 0}, ${y || 0} px)` : "—";

  return `
🛍 <b>НОВЫЙ ЗАКАЗ LOOM</b>

━━━━━━━━━━━━━━━━━━━━
📦 <b>ТОВАР</b>
━━━━━━━━━━━━━━━━━━━━
▫️ Товар: <b>${escapeHtml(data.item || "Футболка")}</b>
▫️ Цвет: <b>${escapeHtml(data.color || "Не указан")}</b> <code>${escapeHtml(data.colorHex || "")}</code>

━━━━━━━━━━━━━━━━━━━━
🎨 <b>ПЕРЕДНЯЯ СТОРОНА</b>
━━━━━━━━━━━━━━━━━━━━
✏️ Текст: <code>${escapeHtml(data.frontText || "Не указан")}</code>
   Шрифт: ${escapeHtml(data.frontFont || "—")} ${data.frontFontSize ? data.frontFontSize + "px" : ""} ${data.frontTextBold ? "<b>Bold</b>" : ""} ${data.frontTextItalic ? "<i>Italic</i>" : ""}
   Цвет текста: <code>${escapeHtml(data.frontTextColor || "—")}</code>
   Позиция: ${pos(data.frontTextX, data.frontTextY)}
🖼 Логотип: ${escapeHtml(data.frontImage || "Не загружено")}
   Масштаб: ${escapeHtml(data.frontImageScale || "—")} | Позиция: ${pos(data.frontImageX, data.frontImageY)}

━━━━━━━━━━━━━━━━━━━━
🎨 <b>ЗАДНЯЯ СТОРОНА</b>
━━━━━━━━━━━━━━━━━━━━
✏️ Текст: <code>${escapeHtml(data.backText || "Не указан")}</code>
   Шрифт: ${escapeHtml(data.backFont || "—")} ${data.backFontSize ? data.backFontSize + "px" : ""} ${data.backTextBold ? "<b>Bold</b>" : ""} ${data.backTextItalic ? "<i>Italic</i>" : ""}
   Позиция: ${pos(data.backTextX, data.backTextY)}
🖼 Логотип: ${escapeHtml(data.backImage || "Не загружено")}
   Масштаб: ${escapeHtml(data.backImageScale || "—")} | Позиция: ${pos(data.backImageX, data.backImageY)}

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
${
  data.comment
    ? `
━━━━━━━━━━━━━━━━━━━━
💬 <b>КОММЕНТАРИЙ</b>
━━━━━━━━━━━━━━━━━━━━
${escapeHtml(data.comment)}
`
    : ""
}
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

// Отправка фото (3D превью дизайна) в Telegram
async function sendTelegramPhoto(botToken, chatId, base64DataUrl, caption = "") {
  const url = `${TELEGRAM_API}${botToken}/sendPhoto`;

  let base64Data = base64DataUrl;
  if (base64DataUrl.includes(";base64,")) {
    base64Data = base64DataUrl.split(";base64,")[1];
  }

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "image/png" });

  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("photo", blob, "design_preview.png");
  if (caption) {
    formData.append("caption", caption.substring(0, 1024));
    formData.append("parse_mode", "HTML");
  }

  const response = await fetch(url, { method: "POST", body: formData });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram Photo API: ${result.description}`);
  return result;
}

// Отправка документа/файла в Telegram
async function sendTelegramDocument(
  botToken,
  chatId,
  fileBase64,
  fileName,
  caption = "",
) {
  const url = `${TELEGRAM_API}${botToken}/sendDocument`;

  // Определяем MIME-тип из base64 или используем переданный
  let mimeType = "application/octet-stream";
  let base64Data = fileBase64;

  if (fileBase64.includes(";base64,")) {
    const matches = fileBase64.match(/^data:([^;]+);base64,/);
    if (matches) {
      mimeType = matches[1];
    }
    base64Data = fileBase64.split(";base64,")[1];
  }

  // Конвертируем base64 в бинарные данные
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });

  // Создаём FormData
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", blob, fileName);
  if (caption) {
    formData.append("caption", caption.substring(0, 1024));
    formData.append("parse_mode", "HTML");
  }

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(`Telegram Document API: ${result.description}`);
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
        },
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
            },
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
            },
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
            },
          );
        }

        // Форматирование и отправка
        const message = formatOrderMessage(orderData);
        const result = await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          env.TELEGRAM_CHAT_ID,
          message,
        );

        // Отправка 3D превью дизайна как фото
        if (orderData.designPreview) {
          try {
            const photoCaption = `🖼 <b>3D превью дизайна</b>\n👤 ${escapeHtml(orderData.customerName)}\n🎨 ${escapeHtml(orderData.color)} | Перед: "${escapeHtml(orderData.frontText)}" | Зад: "${escapeHtml(orderData.backText)}"`;
            await sendTelegramPhoto(
              env.TELEGRAM_BOT_TOKEN,
              env.TELEGRAM_CHAT_ID,
              orderData.designPreview,
              photoCaption,
            );
          } catch (photoErr) {
            console.error("Failed to send design preview photo:", photoErr);
          }
        }

        // Отправка оригинального файла, если загружен
        if (orderData.originalFile && orderData.originalFile.base64) {
          try {
            const fileName = orderData.originalFile.name || "design_image.png";
            const caption = `📎 <b>Оригинальный файл</b>\n👤 ${escapeHtml(orderData.customerName)}\n📁 ${escapeHtml(fileName)}`;

            await sendTelegramDocument(
              env.TELEGRAM_BOT_TOKEN,
              env.TELEGRAM_CHAT_ID,
              orderData.originalFile.base64,
              fileName,
              caption,
            );
          } catch (fileError) {
            console.error("Failed to send file:", fileError);
            // Не прерываем выполнение, заказ уже отправлен
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "Order sent to Telegram",
            messageId: result.result?.message_id,
          }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
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
          },
        );
      }
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  },
};

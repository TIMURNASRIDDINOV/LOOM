/**
 * LOOM Telegram Orders — RETIRED.
 *
 * Order notifications are sent by the main backend (backend/src/routes/cart.ts)
 * after the order is saved, so this Worker no longer accepts anything. It
 * answers every request with 410 until it is deleted (`wrangler delete`).
 */

export default {
  async fetch() {
    return new Response(JSON.stringify({ error: "Gone" }), {
      status: 410,
      headers: { "Content-Type": "application/json" },
    });
  },
};

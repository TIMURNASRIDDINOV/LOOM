/* ================================================================
   LOOM — payment-provider abstraction (gateway-ready, Uzbekistan).

   The checkout flow is provider-agnostic: an order is created first
   (payment_method recorded, payment_status='unpaid'), then — for
   online methods — createPaymentUrl() builds the provider redirect.
   Providers flip payment_status via webhooks (routes/payments.ts).

   To CONNECT a provider, set its secrets and fill in the marked TODOs:
     wrangler secret put PAYME_MERCHANT_ID     (+ PAYME_KEY)
     wrangler secret put CLICK_MERCHANT_ID     (+ CLICK_SERVICE_ID, CLICK_SECRET)
     wrangler secret put UZUM_MERCHANT_ID      (+ UZUM_SECRET)
   Nothing else in the checkout flow needs to change.
================================================================ */

export type PaymentMethod = 'cod' | 'payme' | 'click' | 'uzum'

export const PAYMENT_METHODS: PaymentMethod[] = ['cod', 'payme', 'click', 'uzum']

export interface PaymentEnvVars {
  PAYME_MERCHANT_ID?: string
  PAYME_KEY?: string
  CLICK_MERCHANT_ID?: string
  CLICK_SERVICE_ID?: string
  CLICK_SECRET?: string
  UZUM_MERCHANT_ID?: string
  UZUM_SECRET?: string
}

export function isValidMethod(m: unknown): m is PaymentMethod {
  return typeof m === 'string' && (PAYMENT_METHODS as string[]).includes(m)
}

/** Is the given online provider fully configured (secrets present)? */
export function providerConfigured(method: PaymentMethod, env: PaymentEnvVars): boolean {
  switch (method) {
    case 'cod': return true
    case 'payme': return !!(env.PAYME_MERCHANT_ID && env.PAYME_KEY)
    case 'click': return !!(env.CLICK_MERCHANT_ID && env.CLICK_SERVICE_ID && env.CLICK_SECRET)
    case 'uzum': return !!(env.UZUM_MERCHANT_ID && env.UZUM_SECRET)
  }
}

/**
 * Build the customer-facing payment URL for an order.
 * Returns null for 'cod' (nothing to redirect to) and for unconfigured providers
 * (the checkout route surfaces that as a clear error before creating the order).
 *
 * Amounts: Payme wants tiyin (UZS × 100); Click wants UZS with decimals.
 */
export function createPaymentUrl(
  method: PaymentMethod,
  order: { id: number; totalPrice: number },
  env: PaymentEnvVars,
): string | null {
  if (method === 'cod') return null
  if (!providerConfigured(method, env)) return null

  switch (method) {
    case 'payme': {
      // Payme checkout: base64 of "m=<merchant>;ac.order_id=<id>;a=<tiyin>"
      const params = `m=${env.PAYME_MERCHANT_ID};ac.order_id=${order.id};a=${order.totalPrice * 100}`
      return `https://checkout.paycom.uz/${btoa(params)}`
    }
    case 'click': {
      const q = new URLSearchParams({
        service_id: env.CLICK_SERVICE_ID!,
        merchant_id: env.CLICK_MERCHANT_ID!,
        amount: String(order.totalPrice),
        transaction_param: String(order.id),
      })
      return `https://my.click.uz/services/pay?${q.toString()}`
    }
    case 'uzum': {
      // TODO(uzum): confirm final checkout-link format with Uzum Bank merchant docs
      const q = new URLSearchParams({
        serviceId: env.UZUM_MERCHANT_ID!,
        orderId: String(order.id),
        amount: String(order.totalPrice * 100),
      })
      return `https://www.uzumbank.uz/open-service?${q.toString()}`
    }
  }
}

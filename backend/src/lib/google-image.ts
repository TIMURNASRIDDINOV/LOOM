// Google Gemini image generation ("Nano Banana") — the PAID provider.
//
// ⚠️ UNVERIFIED. Every other provider path in this spike was probed against the
// live service before shipping; this one could not be — there is no Gemini API
// key to probe with. It is written from Google's published REST docs:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   header: x-goog-api-key: <key>
//   body:   { contents: [{ parts: [{ text }] }],
//             generationConfig: { responseModalities: ['TEXT','IMAGE'],
//                                 imageConfig: { aspectRatio, imageSize } } }
//   image:  candidates[0].content.parts[].inlineData.data  (base64)
//           candidates[0].content.parts[].inlineData.mimeType
//
// Before trusting this, run ONE real generation with a key set and confirm the
// bytes decode to an image (see docs/comment in routes/admin-ai.ts). The docs
// have been wrong before (the FLUX.2 klein input schema was undocumented and
// the first Gemini doc lookup returned a non-existent /interactions endpoint),
// so treat the first live response as the source of truth and correct here.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiImageOptions {
  /** '1:1' | '16:9' | '4:3' | ... — square for t-shirt artwork by default */
  aspectRatio?: string
  /** '1K' | '2K' | '4K' — 2K matches the $0.134 (Pro) / $0.05 (Flash) estimates */
  imageSize?: string
}

export interface GeminiImageResult {
  bytes: Uint8Array
  mime: string
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Generate one image from a text prompt. Throws on any non-2xx response or a
 * response with no image part — the caller ledgers the (already-billed) attempt
 * and surfaces the error in its result tile.
 */
export async function generateGeminiImage(
  apiKey: string,
  modelId: string,
  prompt: string,
  opts: GeminiImageOptions = {},
): Promise<GeminiImageResult> {
  const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // Image models require TEXT to be allowed alongside IMAGE; image-only is
        // rejected by some of them, so ask for both and pick the image part out.
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: opts.aspectRatio ?? '1:1',
          imageSize: opts.imageSize ?? '2K',
        },
      },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>
    promptFeedback?: { blockReason?: string }
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`)
  }

  // Do NOT assume parts[0] is the image — a response can carry a text part too.
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => p.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    throw new Error(
      `Gemini response had no image part (keys: ${JSON.stringify(Object.keys(data))}, ` +
        `parts: ${parts.length})`,
    )
  }

  return {
    bytes: decodeBase64(imagePart.inlineData.data),
    mime: imagePart.inlineData.mimeType || 'image/png',
  }
}

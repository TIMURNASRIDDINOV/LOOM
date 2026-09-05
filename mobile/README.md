# LOOM — mobile app

Native iOS/Android app built with Expo + expo-router, implementing
`LOOM Mobile App.dc.html` from the Claude Design handoff.

It talks to the production backend at `https://api.loomdesign.uz` — the same
D1/Workers API the web storefront uses.

## Running it

```bash
npm install
```

Start the dev server and open it on a simulator:

```bash
npx expo run:ios
```

Android:

```bash
npx expo run:android
```

Everything the app uses is in the Expo Go module set, so `npx expo start` and
scanning the QR code works too.

### Building an APK / simulator build

The machine that built this had no JDK or Android SDK, so builds run on EAS
(Expo's cloud). The signing keystore was generated there and lives in the Expo
account — it is not in this repo, and it must not be regenerated once the app
is on Play, or updates will be rejected as a different app.

```bash
npx eas-cli build --platform android --profile preview   # installable APK
npx eas-cli build --platform ios --profile preview       # iOS simulator build
```

`production` produces an AAB for the Play Store instead, and auto-increments
`versionCode`.

To build locally instead, install a JDK 17 and the Android SDK, then
`npx expo run:android --variant release`.

### Web preview (for demos and layout checks)

The browser enforces CORS and `api.loomdesign.uz` only allows
`https://loomdesign.uz`, so the plain web target shows empty screens. A small
dev proxy fixes that:

```bash
node scripts/dev-proxy.js                       # terminal 1 → http://localhost:8787
EXPO_PUBLIC_API_BASE=http://localhost:8787 EXPO_PUBLIC_SITE_ORIGIN=http://localhost:8787 npx expo start --web
```

The 3D preview and the delivery map have `.web.tsx` builds that run the same
pages in an `<iframe>`, so the whole flow — including the 3D garment — works in
a browser. Native clients send no `Origin` and need none of this.

## Screens

| Route | Screen | Data |
| --- | --- | --- |
| `app/onboarding.tsx` | 3-slide intro, shown once | local |
| `app/login.tsx` | Telegram phone · Google · Discord · email/password | **live** `/api/auth/*` |
| `app/studio.tsx` | The configurator — 2D stage and real 3D | live product, local design state (persisted) |
| `app/(tabs)/index.tsx` | Home | **live** `/api/products`, `/api/artworks` |
| `app/(tabs)/catalog.tsx` | Catalog, Все/Кастом/Готовые | **live** `/api/products` |
| `app/(tabs)/product.tsx` | Ready-made product detail | **live** `/api/products` |
| `app/(tabs)/cart.tsx` | Cart | local, synced at checkout |
| `app/(tabs)/checkout.tsx` | 3-step checkout, map pin, payment methods | **live** `/api/cart/checkout`, `/api/payments/methods` |
| `app/(tabs)/orders.tsx` | Orders + status ladder | **live** `/api/me/orders` |
| `app/(tabs)/account.tsx` | Profile, links, sign-out, delete account | **live** `/api/auth/me` |
| `app/(tabs)/profile-edit.tsx` | Name, phone, avatar, saved address | **live** `/api/auth/profile`, `/api/auth/avatar` |
| `app/(tabs)/market.tsx` | Designer marketplace | **live** `/api/artworks` |
| `app/(tabs)/designer.tsx` | A designer's public page | **live** `/api/designers/:handle` |
| `app/(tabs)/publish.tsx` | Designer cabinet: earnings, works, upload flow | **live** `/api/designer/*` |

Everything is wired to production. Nothing is mocked.

## How it fits the existing backend

**Auth.** The web storefront rides on the `user_token` httpOnly cookie. A
native client has no cookie jar, so the app stores the same JWT in the keychain
(`expo-secure-store`) and sends it as a Bearer token — the backend accepts either.
See `src/api/client.ts`. Social sign-in runs PKCE in the system browser and hands
the code to the Worker (`src/api/oauth.ts`; provider setup in `OAUTH_SETUP.md`).

**Telegram sign-in.** Identical to the web flow: `POST /api/auth/telegram/start`
→ open the deep link → poll `/api/auth/telegram/status` every 2 s → store the
returned token. The body token is single-use, so it is stored on the first
`verified` poll. Only Telegram produces the verified phone an order requires.

**Cart.** `/api/cart` is account-bound and auth-only, but the design lets you
build a garment and reach the cart before signing in. So the cart lives locally
(`AsyncStorage`) and is pushed to the server at checkout. See `src/state/cart.tsx`.

**Design JSON.** `src/api/design.ts` serialises the studio into the same
`design_json` **v2** shape the web configurator emits — same normalised `nx`/`ny`
coordinates, radians for rotation, the web's `scalePct` and text-size units,
and the R2 `key` of every bitmap. An app order therefore lands in the admin
order view and the print-master pipeline exactly like a web order. Marketplace
artwork additionally carries `artworkId`, which is what credits the sale to the
designer at checkout (`artwork_sales`, migration 0018).

**Print geometry.** `src/lib/print.ts` holds the constants the flat stage, the
3D preview and `design_json` share (texture size, 30 × 40 cm platen, reference
rect, image-scale semantics). Change them there or nowhere.

## 3D preview

`src/components/Model3D.tsx` hosts a WebView running `src/lib/scene-html.ts` — a
port of the web configurator's rendering pipeline (UV normalisation, front/back
mesh classification by node name, platen measurement, `drawElementIn`, camera
fit) on the site's own vendored three.js r128. The page loads once per model;
colour, layers and the front/back flip are pushed with `injectJavaScript`.

The WebView's document is given `https://loomdesign.uz` as its base URL so the
vendored scripts load from our edge and model/artwork fetches carry an allowed
`Origin`; public files under `/api/files/models|artwork` are also served with
`Access-Control-Allow-Origin: *`. Local uploads are inlined as data: URIs
(`src/lib/files.ts`). Products without their own GLB render on the web's default
meshopt-compressed t-shirt, like the website does. A mesh with no
`Body_Front`/`Body_Back` nodes (the current hoodie) shows «принт на этой
3D-модели скоро» — see `assets/models/README.md` for why.

## Analytics

`src/api/track.ts` posts the same allow-listed funnel events as the storefront
(`cfg_open`, `cfg_design_add`, `cfg_preview_3d`, `cfg_cart`, `cfg_order`) with
`device_type: 'app'`, so the admin dashboard counts app sessions alongside web.

## Design system

Tokens in `src/theme/tokens.ts` come from `assets/theme.css` via the prototype:
coral `#fc5044`, ink `#131311`, paper `#f4f2ed`, Inter Tight / Inter / IBM Plex
Mono. Per the design's own note, the app softens the web's 2px rules to 1.5px
and keeps hard offset shadows only on primary CTAs and the active step —
everything else is a hairline.

`src/theme/type.ts` mirrors the prototype's CSS `font:` shorthands, so any type
value can be traced back to the design.

## Not yet done

- The app is Russian only; the web is trilingual via `assets/i18n.js`.
- Online payment buttons appear automatically once Payme/Click merchant secrets
  are set on the Worker; until then checkout offers cash on delivery.
- Facebook sign-in is registered but blocked on Meta App Review (see
  `OAUTH_SETUP.md`).
- Push notifications: order status changes arrive in Telegram, not as push.

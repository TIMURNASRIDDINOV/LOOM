# LOOM — mobile app

Native iOS/Android app built with Expo + expo-router, implementing
`LOOM Mobile App.dc.html` from the Claude Design handoff.

It talks to the existing production backend at `https://api.loomdesign.uz` —
the same D1/Workers API the web storefront uses. No new backend was added.

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

### Building an APK

The machine that built this had no JDK or Android SDK, so builds run on EAS
(Expo's cloud). The signing keystore was generated there and lives in the Expo
account — it is not in this repo, and it must not be regenerated once the app
is on Play, or updates will be rejected as a different app.

```bash
npx eas-cli build --platform android --profile preview
```

`preview` produces an installable **APK** for sideloading and testing.
`production` produces an **AAB** for the Play Store instead, and
auto-increments `versionCode`.

To build locally instead, install a JDK 17 and the Android SDK, then
`npx expo run:android --variant release`.

There is also a web target — `npx expo start --web` — which is handy for
checking layout quickly. It is a preview aid, not a shipping target: the
browser enforces CORS and `api.loomdesign.uz` only allows `https://loomdesign.uz`,
so live data will not load there. Native clients send no `Origin` and are
unaffected.

## Screens

Eleven screens, matching the design one-for-one.

| Route | Screen | Data |
| --- | --- | --- |
| `app/onboarding.tsx` | 3-slide intro, shown once | local |
| `app/login.tsx` | Phone → Telegram verification | **live** `/api/auth/telegram/*` |
| `app/studio.tsx` | The configurator | live product, local design state |
| `app/(tabs)/index.tsx` | Home | **live** `/api/products` |
| `app/(tabs)/catalog.tsx` | Catalog, Все/Кастом/Готовые | **live** `/api/products` |
| `app/(tabs)/product.tsx` | Ready-made product detail | **live** `/api/products` |
| `app/(tabs)/cart.tsx` | Cart | local, synced at checkout |
| `app/(tabs)/checkout.tsx` | 3-step checkout | **live** `/api/cart/checkout` |
| `app/(tabs)/orders.tsx` | Orders + status ladder | **live** `/api/me/orders` |
| `app/(tabs)/account.tsx` | Profile | **live** `/api/auth/me` |
| `app/(tabs)/market.tsx` | Designer marketplace | **mock** |
| `app/(tabs)/publish.tsx` | Designer publish flow | **mock** |

## What is mocked, and why

The marketplace and the designer publish flow are new in this design. The
backend has no artwork table, no markup column and no moderation queue, so
those two screens run on fixtures in `src/api/market.ts`. The file picker and
its validation are real; the submit is local.

Everything else is wired to production.

## How it fits the existing backend

**Auth.** The web storefront rides on the `user_token` httpOnly cookie. A
native client has no cookie jar, so the app stores the same JWT in the keychain
(`expo-secure-store`) and sends it as a Bearer token — the backend already
accepts either. See `src/api/client.ts`.

**Telegram sign-in.** Identical to the web flow: `POST /api/auth/telegram/start`
→ open the deep link → poll `/api/auth/telegram/status` every 2 s → store the
returned token. The body token is single-use, so it is stored on the first
`verified` poll.

**Cart.** `/api/cart` is account-bound and auth-only, but the design lets you
build a garment and reach the cart before signing in. So the cart lives locally
(`AsyncStorage`) and is pushed to the server at checkout, right after the
sign-in an order requires anyway. See `src/state/cart.tsx`.

**Design JSON.** `src/api/design.ts` serialises the studio into the same
`design_json` **v2** shape the web configurator emits — same normalised `nx`/`ny`
coordinates, same `refRect`, same `platenCm`. An app order therefore lands in
the admin order view and the print-master pipeline exactly like a web order.
Changing that shape breaks production.

## Design system

Tokens in `src/theme/tokens.ts` come from `assets/theme.css` via the prototype:
coral `#fc5044`, ink `#131311`, paper `#f4f2ed`, Inter Tight / Inter / IBM Plex
Mono. Per the design's own note, the app softens the web's 2px rules to 1.5px
and keeps hard offset shadows only on primary CTAs and the active step —
everything else is a hairline.

`src/theme/type.ts` mirrors the prototype's CSS `font:` shorthands, so any type
value can be traced back to the design.

## Not yet done

- Marketplace + publish need a backend (artwork table, markup, moderation).
- Checkout's map is the design's grid plate; wiring a real picker means adding
  `react-native-maps` and reusing `assets/address-picker.js`'s Uber-style flow.
- Language and theme switches in Профиль are local state — the app is Russian
  only so far, while the web is trilingual via `assets/i18n.js`.
- No 3D preview: the studio's 3D tab shows a product photograph. The web
  configurator's three.js stage has no native equivalent yet.

# Social sign-in — setup status

## ✅ Google — DONE and live

GCP project **LOOM** (`loom-506313`), consent screen configured (External,
support + contact `timurnasriddinov56@gmail.com`), two OAuth clients created:

| Client | Type | Bound to |
| --- | --- | --- |
| LOOM Android | Android | package `uz.loomdesign.app`, SHA-1 `4E:01:72:33:…:EF:48` |
| LOOM iOS | iOS | bundle `uz.loomdesign.app` |

Both client ids are set as Worker secrets (`GOOGLE_CLIENT_ID_ANDROID`,
`GOOGLE_CLIENT_ID_IOS`) and `GET /api/auth/oauth/providers?platform=…` returns
the right one per platform.

**Two things to know:**

1. **Published to production.** The consent screen started in Testing, which
   admits only listed test users — that would have blocked every sign-in. It is
   now *In production*, so any Google account works. No Google review was
   needed because the app requests only `openid`, `profile` and `email`; asking
   for a sensitive scope later would trigger verification.
2. **The SHA-1 is the EAS keystore's.** If you ever rotate that keystore, or Play
   App Signing re-signs the app on upload, the fingerprint changes and Google
   sign-in breaks until you add the new SHA-1 to the Android client.

## ✅ Discord — DONE and live

Application **LOOM**, client id `1540714540722036766`, redirect `loom://redirect`
registered. Both `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set on the
Worker and the provider is served to the app.

> The client secret was **reset** during setup. Discord permanently hides the
> original after creation, and the copy-to-clipboard route could not be read
> back, so a reset was the only way to obtain it. The app was minutes old and
> the secret had never been used, so nothing broke. If you ever reset it again,
> update `DISCORD_CLIENT_SECRET` or sign-in stops working.

Unlike Facebook, Discord has no review gate — it works for any Discord account
right now.

## ⛔ Facebook — created, but blocked on a different redirect design

App **LOOM**, id `1570833224516331`, Facebook Login use case added,
`FACEBOOK_CLIENT_ID` set. It is deliberately **not** live: `FACEBOOK_CLIENT_SECRET`
is unset, so `/api/auth/oauth/providers` omits it and the button shows «скоро».

Two things block it, one of them structural:

1. **`loom://redirect` cannot be used.** Meta locks *Require HTTPS* on for apps
   created after 2018, and the setting would not toggle off. Facebook rejected
   the custom scheme. Google solves this with a reversed-client-id scheme and
   Discord simply allows custom schemes; Facebook allows neither.

   The fix is a **server-side callback**: point Facebook at
   `https://api.loomdesign.uz/api/auth/oauth/facebook/callback`, have the Worker
   exchange the code and then deep-link back into the app with a single-use
   session id — the same shape as the Telegram flow. That is new backend code,
   not configuration.

2. **App Review.** Even wired up, the app starts in development mode where only
   listed testers can sign in. Releasing `email` publicly needs Meta App Review
   *and* business verification — a multi-week process.

Given both, Facebook is the right thing to finish last.

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

## ⛔ Facebook and Discord — blocked on you

Neither portal was signed in, and I cannot enter passwords to authenticate.
Log into both in Chrome and they can be finished in one pass.

## Remaining provider steps

### Facebook — [Meta for Developers](https://developers.facebook.com/apps)

1. Create an app → add **Facebook Login**.
2. Settings → Basic: note the App ID and App Secret.
3. Facebook Login → Settings → Valid OAuth Redirect URIs: add `loom://redirect`.
4. The app stays in development mode until you submit `email` for App Review —
   only listed test users can sign in before that.

### Discord — [Developer Portal](https://discord.com/developers/applications)

1. New Application → OAuth2.
2. Redirects: add `loom://redirect`.
3. Copy the Client ID and Client Secret.

## Setting the credentials

```bash
cd backend
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put FACEBOOK_CLIENT_ID
npx wrangler secret put FACEBOOK_CLIENT_SECRET
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
```

Set only the pairs you have. `GET /api/auth/oauth/providers` returns exactly the
providers whose **id and secret are both present**, and the app's sign-in sheet
renders from that response — so a provider goes live the moment its pair lands,
with no app release.

## Before any of this works

The Worker routes and the migration have to be deployed:

```bash
cd backend
npx wrangler d1 execute loom-db --remote --file migrations/0017_oauth_designers.sql
npx wrangler deploy
```

The migration adds `user_identities`, the `artworks` table, and three
`users` columns. It has been dry-run against SQLite; both uniqueness guards
(one provider account cannot attach to two LOOM users, and designer handles are
unique while allowing many NULLs) were verified.

## Account-linking rule

A social identity merges into an existing email account **only when the provider
reports the email verified**. Matching on an unverified email would let someone
register your address at a lax provider and walk into your LOOM account. Google
and Discord report this explicitly; Facebook only releases an email once
confirmed, so its presence is the signal.

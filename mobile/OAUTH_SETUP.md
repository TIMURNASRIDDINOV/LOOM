# Social sign-in — what's left to do

The code is done on both sides. What remains is registering the app with each
provider and putting the credentials on the Worker. Until a provider's two
values are set, its button renders greyed out with «скоро» and nothing breaks.

## The redirect URI

Every provider needs this exact string registered:

```
loom://redirect
```

It comes from `scheme: "loom"` in `app.json`. If you change the scheme, change
it in all three provider consoles too.

> Note: `loom://redirect` is a custom-scheme URI. Google no longer accepts these
> for **Web** OAuth clients — you must create an **Android** and an **iOS**
> client (they take a package name / bundle id instead of a redirect URI), or
> use an https redirect via Expo's proxy. Facebook and Discord accept the custom
> scheme directly.

## Per provider

### Google — [Cloud Console](https://console.cloud.google.com/apis/credentials)

1. Create an OAuth consent screen (External), add the `email` and `profile`
   scopes.
2. Create credentials → OAuth client ID:
   - **Android**: package `uz.loomdesign.app`, plus the SHA-1 of the signing
     certificate. EAS holds that keystore — get the fingerprint with
     `npx eas-cli credentials -p android`.
   - **iOS**: bundle id `uz.loomdesign.app`.
   - **Web**: also create one — its client id/secret is what the Worker uses
     for the token exchange.
3. Set the Worker secrets from the **Web** client.

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

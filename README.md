# Crawler

A DM dungeon mapper. DMs sign in with Google and keep their campaigns on the server; players join with a link over WebSockets, no account needed.

## Scripts

```bash
npm install
npm run dev      # Vite + Workers runtime (table relay included)
npm run build
npm run preview  # local Workers preview of the production build
npm run deploy   # build, then wrangler deploy
```

Deploy uses [Cloudflare Workers](https://developers.cloudflare.com/workers/) and Wrangler 4. The React app is static assets. The Worker ([worker/](worker/)) adds:

- `/auth/*` — Google sign-in for DMs, ending in a signed session cookie.
- `/api/*` — the signed-in DM's campaigns.
- `/crawler-sync` — one `TableRoom` Durable Object per campaign. It keeps the latest map, checks that only the owner can host, and relays moves, dice and presence.
- `DmLibrary` — one Durable Object per DM, listing their campaigns.

## Google sign-in setup

Hosting needs Google OAuth credentials; without them the app still runs, but the Table menu says hosting isn't set up.

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**.
2. Under **Authorized redirect URIs**, add one per origin you serve from:
   - `http://localhost:5173/auth/google/callback` (dev)
   - `https://<your-worker>.workers.dev/auth/google/callback` and any custom domain (prod)
3. Set the OAuth consent screen's scopes to `openid`, `email` and `profile`.
4. Local dev: create `.dev.vars` in the project root (gitignored):

   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   SESSION_SECRET=<a long random string, e.g. openssl rand -base64 32>
   ```

5. Production:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   ```

Changing `SESSION_SECRET` signs everyone out; campaigns are unaffected.

First deploy: `npx wrangler login`, then `npm run deploy`.

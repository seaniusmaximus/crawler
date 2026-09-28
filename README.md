# Crawler

A DM dungeon mapper. Host a table in the browser; players join the same origin over WebSockets.

## Scripts

```bash
npm install
npm run dev      # Vite + Workers runtime (table relay included)
npm run build
npm run preview  # local Workers preview of the production build
npm run deploy   # build, then wrangler deploy
```

Deploy uses [Cloudflare Workers](https://developers.cloudflare.com/workers/) and Wrangler 4. The React app is static assets; `/crawler-sync` is a Durable Object room so every connected client sees the same path and token slide.

First deploy: `npx wrangler login`, then `npm run deploy`.

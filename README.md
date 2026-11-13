# Tally

Cart total calculator. Add items by hand, or upload a cart screenshot / product photos and Gemini extracts the items.

```
index.html                 the whole front end
edge-functions/api/scan.js POST /api/scan, calls Gemini (key stays server-side)
edge-functions/api/share.js POST/GET /api/share, short share codes stored in EdgeOne KV
.env.example               env var names
```

## Run locally (VS Code)

```bash
npm install -g edgeone
cp .env.example .env        # then put your real GEMINI_API_KEY in .env
edgeone pages dev
```

Open the URL it prints. Opening index.html directly works for manual entry, but scanning needs the dev server.

## Push to GitHub

```bash
git init
git add .
git commit -m "Tally"
git branch -M main
git remote add origin https://github.com/YOU/tally.git
git push -u origin main
```

`.env` is git-ignored, so your key is never uploaded.

## Deploy on EdgeOne Pages

1. EdgeOne Pages console → Create project → Import Git repository → pick the repo.
2. No framework and no build command are needed. It is a static site plus the `edge-functions` folder.
3. In the environment variables section add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, `ALLOWED_ORIGIN`).
4. Deploy. Redeploy after changing env vars so they take effect.

## Short share codes (optional)

Sharing already works with a long code or link (the whole cart is packed into the URL). Short codes like `K7M2-9QXP` need somewhere to store the cart. Pick one:

**Option A: Upstash Redis (no approval needed)**

1. Create a free account at upstash.com and create a Redis database in a region near your users.
2. On the database page, open the REST API section and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Use the normal read/write token, not the read-only one.
3. Add both as environment variables in EdgeOne Pages (and in `.env` for local dev), then redeploy.

**Option B: EdgeOne KV (once your access request is approved)**

1. Console → Storage → KV → create a namespace.
2. Open your project → KV Storage → bind it with the variable name `TALLY_KV` (exactly this name).
3. Redeploy.

If both are set up, Upstash is used. If neither is, the Share sheet quietly falls back to the long link and code, so nothing breaks.

- Codes last 90 days by default (`SHARE_TTL_DAYS`). Upstash deletes expired codes itself. KV has no expiry, so expired codes are removed when someone opens them.
- Upstash is consistent immediately. KV can take up to about 60 seconds to sync, so a brand-new code may briefly say "not found".
- Anyone with a code can read that cart, and anyone can create codes through the endpoint. Set `ALLOWED_ORIGIN` to limit creation to your site. Check your Upstash plan's current free limits.

## Notes

- Anyone who finds your site can call `/api/scan` and spend your Gemini quota. Set `ALLOWED_ORIGIN` to your site's URL and set a quota or budget cap on the key in Google AI Studio / Cloud.
- Images are shrunk to 1400px JPEGs in the browser before upload to stay under request size limits.
- If Google retires the default model, set `GEMINI_MODEL` to a current one.
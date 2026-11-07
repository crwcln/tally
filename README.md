# Tally

Cart total calculator. Add items by hand, or upload a cart screenshot / product photos and Gemini extracts the items.

```
index.html                 the whole front end
edge-functions/api/scan.js POST /api/scan, calls Gemini (key stays server-side)
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

## Notes

- Anyone who finds your site can call `/api/scan` and spend your Gemini quota. Set `ALLOWED_ORIGIN` to your site's URL and set a quota or budget cap on the key in Google AI Studio / Cloud.
- Images are shrunk to 1400px JPEGs in the browser before upload to stay under request size limits.
- If Google retires the default model, set `GEMINI_MODEL` to a current one.

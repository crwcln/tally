// EdgeOne Pages Edge Function  ->  POST /api/scan
// Env vars (set in the EdgeOne Pages console, or in .env for local dev):
//   GEMINI_API_KEY  (required)
//   GEMINI_MODEL    (optional, default below)
//   ALLOWED_ORIGIN  (optional, e.g. https://your-site.edgeone.app)

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_IMAGES = 6;
const MAX_TOTAL_CHARS = 6_000_000; // base64 characters across all images
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const PROMPT =
  'You are extracting purchasable items from the attached images (Amazon cart screenshots, receipts, or product photos). ' +
  'List every distinct item with its per-unit price in USD as a number and its quantity (default 1). ' +
  'If a product photo has no visible price, give your best estimate of the typical retail price. ' +
  'Use short, clear item names. Respond with ONLY a JSON array like [{"name":"Item","price":12.99,"qty":1}].';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'Server is missing GEMINI_API_KEY.' }, 500);
  }
  if (env.ALLOWED_ORIGIN) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'Forbidden.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  if (!images.length) return json({ error: 'No images received.' }, 400);

  let total = 0;
  for (const img of images) {
    if (!img || !ALLOWED_MIME.includes(img.mime) || typeof img.data !== 'string') {
      return json({ error: 'Unsupported image format.' }, 400);
    }
    total += img.data.length;
  }
  if (total > MAX_TOTAL_CHARS) {
    return json({ error: 'Images are too large. Try fewer or smaller screenshots.' }, 413);
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const parts = [
    { text: PROMPT },
    ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })),
  ];

  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
      }
    );
  } catch (e) {
    console.error('Gemini fetch failed', e);
    return json({ error: 'Couldn’t reach the AI service.' }, 502);
  }

  if (!upstream.ok) {
    console.error('Gemini error', upstream.status, await upstream.text().catch(() => ''));
    if (upstream.status === 429) return json({ error: 'Too many requests. Try again in a moment.' }, 429);
    return json({ error: 'The AI service returned an error.' }, 502);
  }

  let items = [];
  try {
    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '[]';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const list = Array.isArray(parsed) ? parsed : parsed.items || [];
    items = list
      .map((it) => ({
        name: String(it?.name ?? '').slice(0, 120).trim(),
        price: Math.max(0, Number(it?.price) || 0),
        qty: Math.min(99, Math.max(1, parseInt(it?.qty, 10) || 1)),
      }))
      .filter((it) => it.name);
  } catch (e) {
    console.error('Parse failure', e);
    return json({ error: 'Couldn’t understand the AI response. Try again.' }, 502);
  }

  return json({ items });
}

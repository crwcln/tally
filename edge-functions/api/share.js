// EdgeOne Pages Edge Function
//   POST /api/share        body: { p: "T1.…" }  ->  { code: "K7M2-9QXP", days: 90 }
//   GET  /api/share?c=CODE                      ->  { p: "T1.…" }
//
// Storage backend (first one that is configured wins):
//   1. Upstash Redis (REST)  env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//   2. EdgeOne KV            namespace bound to the project as TALLY_KV
// With neither, this returns 501 and the app falls back to long share codes.
//
// Optional env vars: SHARE_TTL_DAYS (default 90), ALLOWED_ORIGIN.

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const CODE_RE = new RegExp('^[' + ALPHA + ']{8}$');
const PAYLOAD_RE = /^T[01]\.[A-Za-z0-9_-]+$/;
const MAX_PAYLOAD = 20000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const ttlDays = (env) => Math.max(1, Number(env && env.SHARE_TTL_DAYS) || 90);

function newCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHA[b % ALPHA.length];
  return s;
}

// Each backend: create(key, value, days) -> true if stored, false if the key already exists
//               read(key) -> string | null        remove(key) -> void
function getBackend(env) {
  const url = env && env.UPSTASH_REDIS_REST_URL;
  const token = env && env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const cmd = async (args) => {
      const r = await fetch(url.replace(/\/+$/, ''), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || 'Upstash HTTP ' + r.status);
      return j.result;
    };
    return {
      // SET … EX <seconds> NX: real expiry, and atomic "only if new"
      create: async (k, v, days) => (await cmd(['SET', k, v, 'EX', Math.round(days * 86400), 'NX'])) === 'OK',
      read: (k) => cmd(['GET', k]),
      remove: (k) => cmd(['DEL', k]),
    };
  }
  if (typeof TALLY_KV !== 'undefined') {
    return {
      create: async (k, v) => {
        if ((await TALLY_KV.get(k)) !== null) return false;
        await TALLY_KV.put(k, v);
        return true;
      },
      read: (k) => TALLY_KV.get(k),
      remove: (k) => TALLY_KV.delete(k),
    };
  }
  return null;
}

const NOT_SET_UP = {
  error: 'Short codes aren’t set up on this site (no Upstash or KV storage configured).',
};

export async function onRequestPost({ request, env }) {
  const db = getBackend(env);
  if (!db) return json(NOT_SET_UP, 501);

  if (env && env.ALLOWED_ORIGIN) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'Forbidden.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const p = body && body.p;
  if (typeof p !== 'string' || p.length > MAX_PAYLOAD || !PAYLOAD_RE.test(p)) {
    return json({ error: 'Invalid cart data.' }, 400);
  }

  try {
    const days = ttlDays(env);
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      if (await db.create('s:' + code, JSON.stringify({ p, t: Date.now() }), days)) {
        return json({ code: code.slice(0, 4) + '-' + code.slice(4), days });
      }
    }
  } catch (e) {
    console.error('share create failed', e);
    return json({ error: 'Storage error. Try again.' }, 502);
  }
  return json({ error: 'Couldn’t create a code. Try again.' }, 503);
}

export async function onRequestGet({ request, env }) {
  const db = getBackend(env);
  if (!db) return json(NOT_SET_UP, 501);

  const raw = (new URL(request.url).searchParams.get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!CODE_RE.test(raw)) return json({ error: 'That code isn’t valid.' }, 400);

  let value;
  try {
    value = await db.read('s:' + raw);
  } catch (e) {
    console.error('share read failed', e);
    return json({ error: 'Storage error. Try again.' }, 502);
  }
  if (!value) return json({ error: 'Not found.' }, 404);

  let rec;
  try {
    rec = JSON.parse(value);
  } catch {
    return json({ error: 'Not found.' }, 404);
  }
  if (!rec || typeof rec.p !== 'string') return json({ error: 'Not found.' }, 404);

  // Upstash expires keys itself; KV has no TTL, so old entries are removed when opened.
  if (Date.now() - Number(rec.t || 0) > ttlDays(env) * 864e5) {
    try { await db.remove('s:' + raw); } catch {}
    return json({ error: 'Not found.' }, 404);
  }
  return json({ p: rec.p });
}
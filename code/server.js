// Barrier Bot's one always-on process (Railway): receives GHL webhooks and runs the job worker.
// GHL calls {{custom_values.barrier_bot_url}}/<path>. Kenny sets that custom value to
// https://<railway-app>/hook/<BARRIER_WEBHOOK_SECRET>, so the secret travels in the path and
// GHL's standard Webhook action needs no extra headers.

const http = require('http');
const crypto = require('crypto');
const { withDb } = require('./shared/db');
const { handle } = require('./routes');
const { startWorker } = require('./worker');

const MAX_BODY = 1024 * 1024;

function secretOk(given) {
  const want = process.env.BARRIER_WEBHOOK_SECRET || '';
  if (want.length < 24) return false; // refuse to run with a weak or missing secret
  const a = Buffer.from(String(given));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// /hook/<secret>/<path...> -> { secret, path }
// A backslash (raw or encoded) is treated as a slash, in case a GHL step was typed with "\" instead of "/".
function splitUrl(url) {
  let raw = String(url || '');
  try { raw = decodeURIComponent(raw); } catch { /* keep as is */ }
  const clean = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^[^/]*?\/hook\//, '/hook/');
  const m = /^\/hook\/([^/?]+)\/([^?]+?)\/?(?:\?.*)?$/.exec(clean);
  return m ? { secret: m[1].trim(), path: m[2].trim() } : null;
}

// Shows the shape of a URL without the secret: /hook/<40 chars>/territory-scan
function maskUrl(url) {
  return String(url || '').replace(/(hook(?:\/|%2f))([^/\\%?]{6,})/i, (_, a, sec) => `${a}<${sec.length} chars>`).slice(0, 200);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function createServer({ runWithDb = withDb } = {}) {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
    const parts = splitUrl(req.url);
    if (req.method !== 'POST' || !parts) {
      // Log what arrived (secret masked) so a wrong GHL step can be diagnosed from Railway's logs.
      if (/hook/i.test(req.url || '')) console.warn(`[404] ${req.method} ${maskUrl(req.url)}`);
      return send(res, 404, { error: 'not found', method: req.method, got: maskUrl(req.url) });
    }
    if (!secretOk(parts.secret)) return send(res, 401, { error: 'unauthorized' });
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad json' }); }
    try {
      const out = await runWithDb((db) => handle(db, parts.path, body));
      if (!out) return send(res, 503, { error: 'no database configured' });
      return send(res, out.status, out.body);
    } catch (e) {
      console.error(`[hook ${parts.path}]`, e.message);
      return send(res, 500, { error: 'failed' }); // GHL retries on 5xx; the dedupe keys stop double work
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(`Barrier Bot listening on ${port}`));
  startWorker();
}

module.exports = { createServer, splitUrl, secretOk };

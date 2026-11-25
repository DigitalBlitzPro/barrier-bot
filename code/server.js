// Barrier Bot's one always-on process (Railway): receives GHL webhooks and runs the job worker.
// GHL calls {{custom_values.barrier_bot_url}}/<path>. Kenny sets that custom value to
// https://<railway-app>/hook/<BARRIER_WEBHOOK_SECRET>, so the secret travels in the path and
// GHL's standard Webhook action needs no extra headers.

const http = require('http');
const crypto = require('crypto');
const { withDb } = require('./shared/db');
const { handle } = require('./routes');
const { startWorker } = require('./worker');
const { renderScan } = require('./scanPage');

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
  const m = /^\/hook\/([^/?]+)(?:\/([^?]*?))?\/?(?:\?.*)?$/.exec(clean);
  return m ? { secret: m[1].trim(), path: (m[2] || '').trim() } : null;
}

async function checkKeys() {
  const out = {};
  const t = (fn) => fn().then(() => 'ok', (e) => String(e.message || e).replace(/Bearer\s+\S+/g, 'Bearer [hidden]').slice(0, 160));
  out.dataforseo = process.env.DATAFORSEO_LOGIN ? await t(async () => {
    const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
    const r = await fetch('https://api.dataforseo.com/v3/appendix/user_data', { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status_code !== 20000) throw new Error(`${r.status} ${j.status_message || ''}`);
    out.dataforseo_balance_usd = j.tasks?.[0]?.result?.[0]?.money?.balance ?? null;
  }) : 'missing';
  out.anthropic = process.env.ANTHROPIC_API_KEY ? await t(async () => {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }) : 'missing';
  out.ghl = process.env.GHL_LOCATION_TOKEN ? await t(async () => {
    const { Ghl } = require('./shared/ghl');
    await new Ghl().fieldId('contact.barrier_scan_link');
  }) : 'missing';
  out.secrets_key = (process.env.BARRIER_SECRETS_KEY || '').length >= 32 ? 'ok' : 'missing or too short';
  out.webhook_secret = (process.env.BARRIER_WEBHOOK_SECRET || '').length >= 24 ? 'ok' : 'missing or too short';
  return out;
}

// Workflow name -> path, for calls that arrive without a path.
const WORKFLOW_PATHS = [
  [/\bS4\b|territory scan/i, 'territory-scan'],
  [/\bC12\b|software connect/i, 'client/software'],
  [/\bC1\b|purchase/i, 'client/create'],
  [/\bC3\b|onboarding submitted/i, 'client/update'],
  [/\bC5b\b|kickoff outcome/i, 'client/activate'],
  [/\bC8\b|payment failed/i, 'client/pause'],
  [/\bC9\b|cancelled/i, 'client/offboard'],
  [/review done/i, 'review/done'],
  [/negative review/i, 'review/approval'],
  [/do not ask/i, 'review/do-not-ask'],
  [/tech photo/i, 'photo'],
];
function pathFromWorkflow(body) {
  const name = String((body && body.workflow && body.workflow.name) || (body && body.customData && body.customData.workflow) || '');
  const hit = WORKFLOW_PATHS.find(([re]) => re.test(name));
  return hit ? hit[1] : null;
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
    // A prospect's Territory Scan page.
    const scanMatch = req.method === 'GET' && /^\/scan\/([A-Za-z0-9_-]{10,40})\/?(?:\?.*)?$/.exec(req.url || '');
    if (scanMatch) {
      try {
        const r = await runWithDb((db) => db.query('select data from barrier.scans where token = $1', [scanMatch[1]]));
        const row = r && r.rows[0];
        if (!row) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Scan not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex' });
        return res.end(renderScan(row.data));
      } catch (e) {
        console.error('[scan page]', e.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end('Something went wrong loading this scan.');
      }
    }
    // Key check: tests each outside service with a free, read-only call. Shows only ok / the error, never a key.
    if (req.method === 'GET' && req.url === '/health/keys') {
      return send(res, 200, await checkKeys());
    }
    // Database check: says whether the bot can reach Supabase and see its tables. Shows no secrets.
    if (req.method === 'GET' && req.url === '/health/db') {
      try {
        const r = await runWithDb((db) => db.query('select count(*)::int as events from barrier.events'));
        if (!r) return send(res, 503, { ok: false, error: 'SUPABASE_DB_URL is not set' });
        return send(res, 200, { ok: true, events: r.rows[0].events });
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e.code || '') + ' ' + String(e.message || '').replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 200) });
      }
    }
    const parts = splitUrl(req.url);
    if (req.method !== 'POST' || !parts) {
      // Log what arrived (secret masked) so a wrong GHL step can be diagnosed from Railway's logs.
      if (/hook/i.test(req.url || '')) console.warn(`[404] ${req.method} ${maskUrl(req.url)}`);
      return send(res, 404, { error: 'not found', method: req.method, got: maskUrl(req.url) });
    }
    if (!secretOk(parts.secret)) return send(res, 401, { error: 'unauthorized' });
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad json' }); }
    // GHL sometimes sends only the Bot URL without the path after it. Every GHL webhook body names its
    // workflow, so the path can be worked out from that instead.
    if (!parts.path) parts.path = pathFromWorkflow(body) || '_unknown';
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

module.exports = { createServer, splitUrl, secretOk, pathFromWorkflow };

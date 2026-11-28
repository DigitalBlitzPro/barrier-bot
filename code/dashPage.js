// The client's private dashboard (/dash/<token>) and the preview page for a written page or article (/work/<token>).
// Same look as the Territory Scan page (scanPage.js). Numbers come only from saved snapshots and work items.

const { sanitizeHtml } = require('./shared/writer');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const STYLE = `:root{--cyan:#00D4FF;--panel:#111820;--line:#1f2a36;--body:#E2EAF2;--muted:#6B8099;--good:#22C55E;--mid:#EAB308;--bad:#EF4444}
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font:16.5px/1.6 "Public Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.w{width:min(860px,100% - 32px);margin:0 auto;padding:24px 0 48px}
h1,h2{font-family:"Bebas Neue",Impact,sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.02em;margin:0}
h1{font-size:clamp(40px,9vw,60px);line-height:.98}h2{font-size:clamp(26px,6vw,36px);margin:40px 0 12px}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:28px;font-size:14px;color:var(--muted)}
.top b{color:#fff;font-weight:700;letter-spacing:.02em}
.sub{color:var(--body);margin:10px 0 0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:24px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.stat b{display:block;font-family:"Bebas Neue",Impact,sans-serif;font-size:38px;font-weight:400;line-height:1;color:var(--cyan)}
.stat span{font-size:13.5px;color:var(--body)}.stat small{display:block;color:var(--muted);font-size:12.5px;margin-top:4px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gridwrap{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.gridwrap h3{margin:0 0 10px;font-size:14px;color:var(--muted);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.c{aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#000}
.good{background:var(--good)}.mid{background:var(--mid)}.bad{background:var(--bad);color:#fff}.na{background:#26323e;color:var(--muted)}
.you{outline:2px solid #fff;outline-offset:1px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:15px}
th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:13px;color:var(--muted);font-weight:600}
td a{color:var(--cyan)}
.note{font-size:13.5px;color:var(--muted);margin-top:10px}
.empty{background:var(--panel);border:1px dashed var(--line);border-radius:10px;padding:16px;color:var(--muted)}
.foot{margin-top:40px;font-size:13px;color:var(--muted);text-align:center}
article{color:var(--body)}article h2{font-size:28px;margin:28px 0 8px;color:#fff}article a{color:var(--cyan)}
@media(max-width:620px){.stats{grid-template-columns:1fr 1fr}.pair{grid-template-columns:1fr}th,td{padding:9px 8px;font-size:14px}}`;

const head = (title) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body><div class="w">`;

function cell(p) {
  if (p.error) return '<div class="c na">·</div>';
  const r = p.rank;
  const cls = !r ? 'bad' : r <= 3 ? 'good' : r <= 10 ? 'mid' : 'bad';
  return `<div class="c ${cls}${p.row === 3 && p.col === 3 ? ' you' : ''}">${r || '20+'}</div>`;
}
const gridBox = (label, snap) => (snap && snap.data && snap.data.points
  ? `<div class="gridwrap"><h3>${esc(label)}: top 3 in ${snap.grid_pct ?? 0}%</h3><div class="grid">${snap.data.points.map(cell).join('')}</div></div>`
  : `<div class="gridwrap"><h3>${esc(label)}</h3><p class="note">Not measured yet.</p></div>`);

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const KIND = { gbp_post: 'Google post', local_page: 'Local page', article: 'Article', site_audit: 'Website check' };
const STATUS = { draft: 'Being written', ready: 'Written, going up soon', scheduled: 'Scheduled', published: 'Live', held: 'On hold', failed: 'Retrying' };

// view: { client, baseline, latest, work: [...], leaders: [{tech, month, total}] }
function renderDash({ client, baseline, latest, work = [], leaders = [] }) {
  const cur = latest || baseline;
  const delta = (a, b) => (a == null || b == null ? '' : a - b > 0 ? `up ${a - b} from the start` : a - b < 0 ? `down ${b - a} from the start` : 'same as the start');
  const rows = work.filter((w) => w.kind !== 'site_audit').slice(0, 30).map((w) => {
    const when = w.published_at || w.scheduled_for || w.created_at;
    const link = w.body && w.body.url ? `<a href="${esc(w.body.url)}">${esc(w.title || KIND[w.kind])}</a>`
      : w.token && w.kind !== 'gbp_post' ? `<a href="/work/${esc(w.token)}">${esc(w.title || KIND[w.kind])}</a>` : esc(w.title || KIND[w.kind]);
    return `<tr><td>${esc(KIND[w.kind] || w.kind)}</td><td>${link}</td><td>${esc(w.kind === 'gbp_post' && w.status === 'scheduled' && new Date(w.scheduled_for) < new Date() ? 'Posted' : STATUS[w.status] || w.status)}</td><td>${esc(fmt(when))}</td></tr>`;
  }).join('');
  const audit = work.find((w) => w.kind === 'site_audit');
  const fixes = audit && audit.body && audit.body.checks ? audit.body.checks.filter((x) => !x.ok).map((x) => `<li>${esc(x.fix)}</li>`).join('') : '';
  const board = leaders.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.tech)}</td><td>${l.month}</td><td>${l.total}</td></tr>`).join('');
  const city = client.registered_city || client.city || '';
  return `${head(`${client.company} | Blitz Barrier dashboard`)}
<div class="top"><b>DIGITAL BLITZ</b><span>Blitz Barrier dashboard${cur ? ` · updated ${esc(fmt(cur.created_at))}` : ''}</span></div>
<h1>${esc(client.company)}</h1>
<p class="sub">How ${esc(client.company)} shows up for homeowners in ${esc(city)}: on Google Maps, in AI answers and in reviews.</p>
${cur ? `<div class="stats">
<div class="stat"><b>${cur.grid_pct ?? 0}%</b><span>of your area where you're top 3 on Maps</span><small>${esc(delta(cur.grid_pct, baseline?.grid_pct))}</small></div>
<div class="stat"><b>${cur.ai_hits ?? 0}/${cur.ai_asked ?? 0}</b><span>AI answers that named you</span><small>${esc(delta(cur.ai_hits, baseline?.ai_hits))}</small></div>
<div class="stat"><b>${cur.reviews ?? 0}</b><span>Google reviews${cur.rating ? ` (${Number(cur.rating)}★)` : ''}</span><small>${esc(delta(cur.reviews, baseline?.reviews))}</small></div>
<div class="stat"><b>${work.filter((w) => ['published', 'scheduled'].includes(w.status) && w.kind !== 'site_audit').length}</b><span>posts and pages put out</span></div>
</div>` : '<p class="empty">Your first measurement is running. Check back in a day.</p>'}

<h2>Google Maps: start vs. now</h2>
<div class="pair">${gridBox(`Start${baseline ? ` (${fmt(baseline.created_at)})` : ''}`, baseline)}${gridBox(`Now${latest ? ` (${fmt(latest.created_at)})` : ''}`, latest)}</div>
<p class="note">Your rank for "pest control" at 49 spots about a mile apart. Green is top 3, yellow 4 to 10, red 11 or lower. White ring: your business.</p>

<h2>Work done for you</h2>
${rows ? `<table><tr><th>What</th><th>Title</th><th>Status</th><th>Date</th></tr>${rows}</table>` : '<p class="empty">Your first posts and pages are being written.</p>'}

${board ? `<h2>Review leaderboard</h2><table><tr><th></th><th>Tech</th><th>This month</th><th>All time</th></tr>${board}</table>
<p class="note">Reviews that came in after a tech's visit.</p>` : ''}

${fixes ? `<h2>Website fixes from your first check</h2><table><tr><td><ul style="margin:0;padding-left:18px">${fixes}</ul></td></tr></table>` : ''}
<p class="foot">Digital Blitz LLC · This page is private to ${esc(client.company)}. Rankings change by the hour; these are snapshots from the dates shown.</p>
</div></body></html>`;
}

async function loadDash(db, token) {
  const client = (await db.query('select * from barrier.clients where dash_token = $1', [token])).rows[0];
  if (!client) return null;
  const snaps = (await db.query(
    `(select * from barrier.snapshots where client_id = $1 and kind = 'baseline' order by created_at asc limit 1)
     union all (select * from barrier.snapshots where client_id = $1 and kind = 'monthly' order by created_at desc limit 1)`, [client.id])).rows;
  const work = (await db.query(
    `select kind, status, title, body, token, scheduled_for, published_at, created_at from barrier.work_items
     where client_id = $1 and status <> 'failed' order by coalesce(published_at, scheduled_for, created_at) desc limit 60`, [client.id])).rows;
  const leaders = (await db.query(
    `select tech, count(*) filter (where at >= date_trunc('month', now()))::int as month, count(*)::int as total
     from barrier.review_events where client_id = $1 and kind = 'done' and coalesce(tech, '') <> ''
     group by tech order by month desc, total desc limit 10`, [client.id])).rows;
  return { client, baseline: snaps.find((s) => s.kind === 'baseline') || null, latest: snaps.find((s) => s.kind === 'monthly') || null, work, leaders };
}

// Preview of a page or article that isn't on the client's site yet (or is waiting to be pasted in).
function renderWork(item, client) {
  const p = item.body || {};
  return `${head(`${p.title || item.title} | preview`)}
<div class="top"><b>DIGITAL BLITZ</b><span>${esc(KIND[item.kind] || 'Page')} for ${esc(client.company)} · ${esc(STATUS[item.status] || item.status)}</span></div>
<p class="note">Page title: ${esc(p.title || item.title)}<br>Address: /${esc(p.slug || '')}<br>Google description: ${esc(p.metaDescription || '')}</p>
<h1>${esc(p.h1 || p.title || item.title)}</h1>
<article>${sanitizeHtml(p.html)}</article>
</div></body></html>`;
}

module.exports = { renderDash, loadDash, renderWork };

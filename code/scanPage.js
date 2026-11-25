// Renders a saved Territory Scan as a self-contained, mobile-first page (served at /scan/<token>).
// Brand: black, Bebas Neue headings, Public Sans body, cyan accent; green good, yellow middling, red bad.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const SALES = 'https://barrier.digitalblitzpro.com/sales-page';

function cell(p) {
  if (p.error) return '<div class="c na" title="not checked">·</div>';
  const r = p.rank;
  const cls = !r ? 'bad' : r <= 3 ? 'good' : r <= 10 ? 'mid' : 'bad';
  const label = r ? String(r) : '20+';
  const center = p.row === 3 && p.col === 3 ? ' you' : '';
  return `<div class="c ${cls}${center}" title="${r ? `#${r}` : 'not in the top 20'}">${label}</div>`;
}

function fmtDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function renderScan(scan) {
  const b = scan.business;
  const g = scan.grid;
  const where = scan.state ? `${scan.city}, ${scan.state}` : scan.city;
  const engines = Object.entries(scan.engines || {});
  const qs = [...new Set(scan.ai.answers.map((a) => a.question))];
  const named = {};
  for (const a of scan.ai.answers) for (const n of a.named || []) named[n] = (named[n] || 0) + 1;
  const namedList = Object.entries(named).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const aiCards = qs.map((q) => `<div class="q"><p>${esc(q)}</p><div class="chips">${engines.map(([key, e]) => {
    const a = scan.ai.answers.find((x) => x.question === q && x.engine === key);
    const cls = !a || a.error ? 'na' : a.mentioned ? 'yes' : 'no';
    const word = !a || a.error ? 'n/a' : a.mentioned ? 'named you' : 'skipped you';
    return `<span class="chip ${cls}">${esc(e.label)}: ${word}</span>`;
  }).join('')}</div></div>`).join('');
  const reviewRows = [
    { name: `${b.name} (you)`, rating: b.rating, reviews: b.reviews, you: true },
    ...g.leaders.map((l) => ({ name: l.name, rating: l.rating, reviews: l.reviews })),
  ].map((r) => `<tr${r.you ? ' class="me"' : ''}><td>${esc(r.name)}</td><td>${r.rating ?? '—'}</td><td>${r.reviews ?? '—'}</td></tr>`).join('');
  const leaderRows = g.leaders.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.spots} of ${g.checked}</td></tr>`).join('');
  const cta = `${SALES}?city=${encodeURIComponent(scan.city)}`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.name)} Territory Scan | Blitz Barrier</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--cyan:#00D4FF;--panel:#111820;--line:#1f2a36;--body:#E2EAF2;--muted:#6B8099;--good:#22C55E;--mid:#EAB308;--bad:#EF4444}
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font:16.5px/1.6 "Public Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.w{width:min(760px,100% - 32px);margin:0 auto;padding:24px 0 48px}
h1,h2{font-family:"Bebas Neue",Impact,sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.02em;margin:0}
h1{font-size:clamp(40px,9vw,64px);line-height:.98}h1 em{font-style:normal;color:var(--cyan)}
h2{font-size:clamp(28px,6vw,38px);margin:40px 0 12px}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:28px;font-size:14px;color:var(--muted)}
.top b{color:#fff;font-weight:700;letter-spacing:.02em}
.verdict{margin-top:18px;font-size:18px;color:var(--body);border-left:3px solid var(--cyan);padding:4px 0 4px 16px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:24px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.stat b{display:block;font-family:"Bebas Neue",Impact,sans-serif;font-size:40px;font-weight:400;line-height:1;color:var(--cyan)}
.stat span{font-size:13.5px;color:var(--body)}
.gridwrap{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;max-width:460px;margin:0 auto}
.c{aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#000}
.good{background:var(--good)}.mid{background:var(--mid)}.bad{background:var(--bad);color:#fff}.na{background:#26323e;color:var(--muted)}
.you{outline:3px solid #fff;outline-offset:2px}
.legend{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:center;margin-top:12px;font-size:13px;color:var(--body)}
.legend i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.note{font-size:13.5px;color:var(--muted);margin-top:10px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:15px}
th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left}th{font-size:13px;color:var(--muted);font-weight:600}
tr.me td{color:var(--cyan);font-weight:600}
.cta{margin-top:40px;background:#0a1c26;border:1px solid rgba(0,212,255,.45);border-radius:10px;padding:22px}
.cta p{margin:6px 0 16px;color:var(--body)}
.btn{display:inline-block;background:var(--cyan);color:#000;font-weight:700;text-decoration:none;border-radius:6px;padding:14px 22px}
.qs{display:grid;gap:10px}.q{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.q p{margin:0 0 10px;color:var(--body)}.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:13.5px;font-weight:600;border-radius:999px;padding:4px 10px;border:1px solid var(--line)}
.chip.yes{color:var(--good);border-color:rgba(34,197,94,.45)}.chip.no{color:var(--bad);border-color:rgba(239,68,68,.45)}.chip.na{color:var(--muted)}
.foot{margin-top:40px;font-size:13px;color:var(--muted);text-align:center}
@media(max-width:520px){.stats{grid-template-columns:1fr}.c{font-size:12px}th,td{padding:9px 8px;font-size:14px}}
</style></head><body><div class="w">
<div class="top"><b>DIGITAL BLITZ</b><span>Territory Scan · ${esc(fmtDate(scan.createdAt.slice(0, 10)))}</span></div>
<h1>${esc(b.name)} <em>vs. ${esc(where)}</em></h1>
<p class="verdict">${esc(scan.verdict)}</p>
<div class="stats">
<div class="stat"><b>${g.top3Pct}%</b><span>of your area where you're top 3 on Google Maps</span></div>
<div class="stat"><b>${scan.ai.mentioned}/${scan.ai.asked}</b><span>AI answers that named you</span></div>
<div class="stat"><b>${b.reviews ?? 0}</b><span>Google reviews${b.rating ? ` (${b.rating}★)` : ''}</span></div>
</div>

<h2>Who homeowners see on Google Maps</h2>
<div class="gridwrap"><div class="grid">${scan.points.map(cell).join('')}</div>
<div class="legend"><span><i style="background:var(--good)"></i>Top 3</span><span><i style="background:var(--mid)"></i>4 to 10</span><span><i style="background:var(--bad)"></i>11+ or not shown</span></div>
<p class="note">Your rank for "${esc(scan.keyword)}" at 49 spots, about a mile apart${b.onMaps ? ', centered on your business (white ring)' : `. We couldn't find ${esc(b.name)} on Google Maps, so this is centered on ${esc(scan.city)}`}.</p></div>
${leaderRows ? `<h2>Who owns the map</h2><table><tr><th>Company</th><th>Top-3 spots</th></tr>${leaderRows}</table>` : ''}

<h2>Do AI assistants recommend you?</h2>
<div class="qs">${aiCards}</div>
${namedList.length ? `<p class="note">Named instead: ${namedList.map(([n]) => esc(n)).join(', ')}.</p>` : ''}

<h2>Reviews vs. the map leaders</h2>
<table><tr><th>Company</th><th>Rating</th><th>Reviews</th></tr>${reviewRows}</table>

<div class="cta"><h2 style="margin:0">Lock in ${esc(scan.city)}</h2>
<p>We take one pest company per city. Start the Blitz Barrier Plan by ${esc(fmtDate(scan.offerDeadline))} and your first month is $199.</p>
<a class="btn" href="${esc(cta)}">See the Blitz Barrier Plan</a></div>
<p class="foot">Digital Blitz LLC · Rankings change by the hour; this is a snapshot from the date above.</p>
</div></body></html>`;
}

module.exports = { renderScan };

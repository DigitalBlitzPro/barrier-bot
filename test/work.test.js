const test = require('node:test');
const assert = require('node:assert');
const { buildReport, monthlyReport } = require('../code/handlers/monthlyReport');
const { monthlyWork, postTimes } = require('../code/handlers/monthlyWork');
const { softwareSync, photoIntake, createSubaccount } = require('../code/handlers/clientJobs');
const { renderDash, renderWork } = require('../code/dashPage');
const { sanitizeHtml } = require('../code/shared/writer');
const { NeedsSetup } = require('../code/shared/queue');

process.env.BARRIER_SECRETS_KEY = process.env.BARRIER_SECRETS_KEY || 'x'.repeat(64);
const { encrypt } = require('../code/shared/secrets');

test('report: compares with last month, finds milestones and risks only from the numbers', () => {
  const work = [{ kind: 'gbp_post', status: 'scheduled' }, { kind: 'gbp_post', status: 'draft' }, { kind: 'local_page', status: 'published' }, { kind: 'article', status: 'ready' }];
  const r = buildReport({ cur: { grid_pct: 55, reviews: 48, rating: 4.8, ai_hits: 2, ai_asked: 10 }, prev: { grid_pct: 40, reviews: 41, ai_hits: 0 }, work, now: new Date('2026-12-26T00:00:00Z') });
  assert.equal(r.month, 'December 2026');
  assert.deepEqual([r.grid, r.prevGrid, r.newReviews, r.posts, r.pages], [55, 40, 7, 1, 2]);
  assert.equal(r.milestone, 'top 3 on Google Maps in 50%+ of the area');
  assert.deepEqual(r.risks, []);
  const bad = buildReport({ cur: { grid_pct: 20, reviews: 41, rating: 3.9, ai_hits: 0 }, prev: { grid_pct: 40, reviews: 41, rating: 4.2, ai_hits: 0 }, work: [] });
  assert.equal(bad.milestone, null);
  assert.equal(bad.risks.length, 3);
});

test('monthlyReport writes the GHL fields and tags, and waits if the snapshot is missing', async () => {
  const client = { id: 4, company: 'Bug Busters', ghl_contact_id: 'c4', registered_city: 'Mesa', dash_token: 'tok1234567890' };
  const cur = { id: 9, kind: 'monthly', cycle: 1, grid_pct: 30, reviews: 12, rating: 4.9, ai_hits: 1, ai_asked: 10, data: {} };
  const base = { id: 8, kind: 'baseline', cycle: 0, grid_pct: 10, reviews: 10, ai_hits: 0, data: {} };
  const mk = (snaps) => ({ async query(sql) {
    if (/from barrier.clients/.test(sql)) return { rows: [client] };
    if (/from barrier.snapshots/.test(sql)) return { rows: snaps };
    if (/from barrier.work_items/.test(sql)) return { rows: [{ kind: 'gbp_post', status: 'scheduled' }] };
    return { rows: [] };
  } });
  const sent = {};
  const ghl = { async setFieldsByName(id, f) { sent.fields = f; }, async addTags(id, t) { sent.tags = t; } };
  const out = await monthlyReport({ db: mk([cur, base]), job: { client_id: 4, dedupe_key: '4:report:1' }, deps: { ghl, notify: async () => {} } });
  assert.equal(out.newReviews, 2);
  assert.equal(sent.fields['Barrier - Grid Pct'], '30');
  assert.equal(sent.fields['Barrier - Milestone City'], 'Mesa');
  assert.deepEqual(sent.tags, ['barrier-report-ready', 'barrier-milestone']);
  assert.match(sent.fields['Barrier - Dashboard Link'], /\/dash\/tok1234567890$/);
  await assert.rejects(monthlyReport({ db: mk([base]), job: { client_id: 4, dedupe_key: '4:report:1' }, deps: { ghl } }), /no snapshot yet/);
});

test('post times: a week apart, never in the past', () => {
  const t = postTimes('2026-11-01T12:00:00Z', new Date('2026-10-30T00:00:00Z'));
  assert.deepEqual(t.map((d) => d.toISOString().slice(0, 10)), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  const late = postTimes('2026-11-01T12:00:00Z', new Date('2026-11-12T00:00:00Z'));
  assert.ok(late.every((d) => d > new Date('2026-11-12T00:00:00Z')));
  assert.ok(late[1] - late[0] >= 86400000);
});

// A small in-memory stand-in for the tables monthlyWork touches.
function workDb(client) {
  const items = []; const jobs = [];
  return {
    items, jobs,
    async query(sql, p = []) {
      if (/from barrier.clients/.test(sql)) return { rows: [client] };
      if (/from barrier.work_items where client_id = \$1 and cycle/.test(sql)) return { rows: items.filter((w) => w.cycle === p[1]) };
      if (/select body from barrier.work_items/.test(sql)) return { rows: items.map((w) => ({ body: w.body })) };
      if (/from barrier.photos/.test(sql)) return { rows: [{ id: 1, url: 'https://x/a.jpg', note: 'sealed a gap under the garage door' }] };
      if (/insert into barrier.work_items/.test(sql)) {
        const kind = /'gbp_post'/.test(sql) ? 'gbp_post' : /'local_page'/.test(sql) ? 'local_page' : 'article';
        const row = { id: items.length + 1, client_id: p[0], cycle: p[1], kind, status: 'draft', title: p[2], body: JSON.parse(p[3]), token: p[4] || null };
        items.push(row); return { rows: [row] };
      }
      const m = /update barrier.work_items set status = '(\w+)'/.exec(sql);
      if (m) { const w = items.find((x) => x.id === p[0]); w.status = m[1]; return { rows: [] }; }
      if (/update barrier.work_items set body/.test(sql)) { for (const id of p[0]) items.find((x) => x.id === id).body.noted = true; return { rows: [] }; }
      return { rows: [] };
    },
  };
}

test('monthlyWork writes 4 posts, 2 pages and an article, schedules posts, and never rewrites on a re-run', async () => {
  const client = { id: 3, company: 'Bug Busters', city: 'Mesa', registered_city: 'Mesa', phone: '4805551212', services_offered: ['Ants', 'Scorpions'], activated_at: '2026-11-01T12:00:00Z' };
  const db = workDb(client);
  let asks = 0;
  const ask = async ({ system }) => { asks++; return /JSON only/.test(system)
    ? { text: JSON.stringify({ title: 'Ant Control in Mesa', slug: 'Ant Control Mesa!', metaDescription: 'd', h1: 'Ants', html: `<p onclick="x()">${'a'.repeat(600)} 100% safe</p><script>bad()</script>` }), usd: 0.01 }
    : { text: 'Fall means mice. Our spray is non-toxic.', usd: 0.001 }; };
  const notes = [];
  const scheduledPosts = [];
  const sub = { async googleAccount() { return { id: 'acc1' }; }, async schedulePost(p) { scheduledPosts.push(p); return `post${scheduledPosts.length}`; } };
  const out = await monthlyWork({ db, job: { id: 1, client_id: 3, dedupe_key: '3:work:0' }, deps: { ask, sub, notify: async (ch, t) => notes.push(t), now: new Date('2026-11-01T13:00:00Z') } });
  assert.equal(asks, 7);
  assert.equal(out.posts, 4);
  assert.equal(out.pagesWaiting, 3);
  assert.equal(scheduledPosts[0].imageUrl, 'https://x/a.jpg');
  assert.match(scheduledPosts[0].text, /family-friendly/);
  const page = db.items.find((w) => w.kind === 'local_page');
  assert.equal(page.body.slug, 'ant-control-mesa');
  assert.doesNotMatch(page.body.html, /script|onclick|100% safe/);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /\/work\//);
  await monthlyWork({ db, job: { id: 1, client_id: 3, dedupe_key: '3:work:0' }, deps: { ask, sub, notify: async (ch, t) => notes.push(t) } });
  assert.equal(asks, 7);
  assert.equal(scheduledPosts.length, 4);
  assert.equal(notes.length, 1);
});

test('monthlyWork keeps the writing and waits when the sub-account is not set up', async () => {
  const client = { id: 3, company: 'Bug Busters', city: 'Mesa', services_offered: ['Ants'] };
  const db = workDb(client);
  const ask = async ({ system }) => (/JSON only/.test(system)
    ? { text: JSON.stringify({ title: 'T', slug: 't', metaDescription: 'd', h1: 'h', html: `<p>${'a'.repeat(600)}</p>` }), usd: 0 } : { text: 'post', usd: 0 });
  await assert.rejects(monthlyWork({ db, job: { id: 1, client_id: 3, dedupe_key: '3:work:0' }, deps: { ask, notify: async () => {} } }), NeedsSetup);
  assert.equal(db.items.filter((w) => w.kind === 'gbp_post' && w.status === 'draft').length, 4);
});

test('software sync asks each finished job once and skips do-not-ask and reviewed customers', async () => {
  const client = { id: 5, company: 'X', ghl_location_id: 'loc1', ask_commercial: false };
  const conn = { software: 'FieldRoutes', secret_enc: encrypt(JSON.stringify({ key: 'k', token: 't', subdomain: 'acme' })) };
  const inserted = [];
  const db = { async query(sql, p) {
    if (/from barrier.clients/.test(sql)) return { rows: [client] };
    if (/from barrier.client_connections/.test(sql)) return { rows: [conn] };
    if (/from barrier.review_events/.test(sql)) return { rows: [{ kind: 'asked', job_id: 'fr:1' }, { kind: 'do_not_ask', phone: '5550000002' }] };
    if (/insert into barrier.review_events/.test(sql)) { inserted.push(p); return { rows: [] }; }
    return { rows: [] };
  } };
  const responses = {
    'appointment/search': { appointments: [{ appointmentID: 1, status: 1, customerID: 11, servicedBy: 7 }, { appointmentID: 2, status: 1, customerID: 12, servicedBy: 7 }, { appointmentID: 3, status: 1, customerID: 13, servicedBy: 7 }, { appointmentID: 4, status: 1, customerID: 14, servicedBy: 7 }] },
    'customer/get': { customers: [{ customerID: 11, fname: 'A', phone1: '5550000001' }, { customerID: 12, fname: 'B', phone1: '5550000002' }, { customerID: 13, fname: 'C', phone1: '5550000003' }, { customerID: 14, fname: 'D', phone1: '5550000004', commercialAccount: '1' }] },
    'employee/get': { employees: [{ employeeID: 7, fname: 'Sam', lname: 'Tech' }] },
  };
  const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(responses[url.split('/api/')[1]]) });
  const upserts = [];
  const sub = { async upsertContact(c) { upserts.push(c); return 'ct3'; } };
  const out = await softwareSync({ db, job: { client_id: 5 }, deps: { fetchImpl, sub } });
  assert.deepEqual(out, { found: 4, asked: 1, skipped: 3 });
  assert.equal(upserts[0].firstName, 'C');
  assert.deepEqual(upserts[0].tags, ['review-eligible']);
  assert.equal(inserted[0][3], 'Sam Tech');
});

test('photo intake saves photo links from the tech form', async () => {
  const rows = [];
  const payload = { contact_id: 'p1', location: { id: 'loc1' }, customData: { tech: 'Sam', note: 'webs cleared', photo_url: 'https://storage.example.com/u/123.jpg' } };
  const db = { async query(sql, p) {
    if (/from barrier.events/.test(sql)) return { rows: [{ id: 1, payload, ghl_location_id: 'loc1' }] };
    if (/from barrier.clients where ghl_location_id/.test(sql)) return { rows: [{ id: 5 }] };
    if (/insert into barrier.photos/.test(sql)) { rows.push(p); return { rows: [] }; }
    return { rows: [] };
  } };
  const out = await photoIntake({ db, job: { event_id: 1 } });
  assert.equal(out.photos, 1);
  assert.deepEqual(rows[0].slice(2), ['https://storage.example.com/u/123.jpg', 'Sam', 'webs cleared']);
});

test('sub-account creation waits for setup without the agency token', async () => {
  const db = { async query() { return { rows: [{ id: 1, company: 'X' }] }; } };
  await assert.rejects(createSubaccount({ db, job: { client_id: 1 }, deps: { env: {} } }), NeedsSetup);
});

test('dashboard and page preview render, and strip unsafe HTML', () => {
  const html = renderDash({ client: { company: 'Bug <Busters>', registered_city: 'Mesa' }, baseline: { grid_pct: 10, reviews: 5, ai_hits: 0, ai_asked: 10, created_at: '2026-11-01', data: { points: [{ row: 3, col: 3, rank: 4 }] } },
    latest: { grid_pct: 30, reviews: 9, ai_hits: 2, ai_asked: 10, created_at: '2026-11-27', data: { points: [] } },
    work: [{ kind: 'local_page', status: 'ready', title: 'Ants in Mesa', token: 'abcdefghijkl', created_at: '2026-11-02' }], leaders: [{ tech: 'Sam', month: 3, total: 9 }] });
  assert.match(html, /Bug &lt;Busters&gt;/);
  assert.match(html, /up 20 from the start/);
  assert.match(html, /\/work\/abcdefghijkl/);
  assert.match(html, /Sam/);
  assert.equal(sanitizeHtml('<p class="x">hi<script>alert(1)</script><a href="javascript:x">l</a><img src=x onerror=y></p>'), '<p>hil</p>');
  assert.doesNotMatch(renderWork({ kind: 'article', status: 'ready', body: { title: 't', html: '<p>ok</p><script>x</script>' } }, { company: 'X' }), /<script>x/);
});

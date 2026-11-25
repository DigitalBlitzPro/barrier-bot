const test = require('node:test');
const assert = require('node:assert');
const { territoryScan, gridPoints, summarizeGrid, pickBusiness, questionsFor } = require('../code/handlers/territoryScan');
const { renderScan } = require('../code/scanPage');

test('grid is 7x7, centered, about a mile apart', () => {
  const pts = gridPoints(42.96, -85.67);
  assert.equal(pts.length, 49);
  assert.deepEqual([pts[24].lat, pts[24].lng], [42.96, -85.67]);
  assert.ok(Math.abs((pts[0].lat - pts[7].lat) * 69 - 1) < 0.01);
});

test('pickBusiness prefers the website, then the name', () => {
  const items = [
    { type: 'maps_search', title: 'Other Pest Co', domain: 'other.com' },
    { type: 'maps_search', title: 'Bug Busters Pest Control - Grand Rapids', domain: 'bugbusters.com' },
  ];
  assert.equal(pickBusiness(items, { company: 'Something Else', website: 'https://www.bugbusters.com/' }).domain, 'bugbusters.com');
  assert.equal(pickBusiness(items, { company: 'Bug Busters Pest Control' }).domain, 'bugbusters.com');
  assert.equal(pickBusiness(items, { company: 'Nobody' }), null);
});

test('summarizeGrid counts top 3 and the leaders', () => {
  const pts = [
    { rank: 1, top3: [{ title: 'Me', isClient: true }, { title: 'A' }, { title: 'B' }] },
    { rank: 5, top3: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] },
    { rank: null, top3: [{ title: 'A' }, { title: 'C' }, { title: 'D' }] },
    { error: 'x' },
  ];
  const s = summarizeGrid(pts);
  assert.equal(s.checked, 3);
  assert.equal(s.top3, 1);
  assert.equal(s.top3Pct, 33);
  assert.equal(s.avgRank, 3);
  assert.equal(s.leaders[0].name, 'A');
  assert.equal(s.leaders[0].spots, 3);
});

test('questions name the city and state', () => {
  assert.match(questionsFor('Grand Rapids', 'Michigan')[0], /Grand Rapids, Michigan/);
});

// A whole scan with fake DataForSEO and database: no network, no GHL.
test('territoryScan runs end to end and renders a page', async () => {
  process.env.ANTHROPIC_API_KEY = '';
  const own = { type: 'maps_search', title: 'Bug Busters', domain: 'bugbusters.com', cid: '42', latitude: 42.96, longitude: -85.67, rating: { value: 4.8, votes_count: 120 }, address_info: { region: 'MI' } };
  const rival = { type: 'maps_search', title: 'Rival Pest', cid: '7', rating: { value: 4.9, votes_count: 800 } };
  let n = 0;
  const dfs = {
    spent: 0,
    async post(path, body) {
      this.spent += 0.002;
      if (path.startsWith('ai_optimization')) return { items: [{ sections: [{ text: n++ % 2 ? 'Try Rival Pest.' : 'Bug Busters is great.' }] }] };
      if (body.keyword.startsWith('Bug Busters')) return { items: [own, rival] };
      return { items: [{ ...rival, rank_group: 1 }, { ...own, rank_group: 2 }] };
    },
  };
  const saved = [];
  const db = {
    async query(sql, params) {
      if (/from barrier.clients/.test(sql)) return { rows: [{ id: 1, ghl_contact_id: 'c1', company: 'Bug Busters', registered_city: 'Grand Rapids', website: 'bugbusters.com' }] };
      saved.push({ sql, params });
      return { rows: [] };
    },
  };
  const out = await territoryScan({ db, job: { id: 9, client_id: 1 }, deps: { dfs, skipGhl: true, log: () => {} } });
  assert.equal(out.onMaps, true);
  assert.equal(out.top3Pct, 100);
  assert.equal(out.aiAsked, 12);
  assert.ok(out.aiMentioned > 0 && out.aiMentioned < 12);
  const scanRow = saved.find((s) => /barrier.scans/.test(s.sql));
  const data = JSON.parse(scanRow.params[3]);
  assert.equal(data.points.length, 49);
  assert.equal(data.grid.leaders[0].name, 'Rival Pest');
  const html = renderScan(data);
  assert.match(html, /Bug Busters/);
  assert.match(html, /Lock in Grand Rapids/);
  assert.ok(!/undefined|NaN/.test(html), 'no undefined/NaN in the page');
});

test('the page escapes names', () => {
  const html = renderScan({ business: { name: '<script>x</script>', onMaps: false, reviews: 0 }, grid: { top3Pct: 0, leaders: [], checked: 0 }, points: [], ai: { asked: 0, mentioned: 0, answers: [] }, engines: {}, city: 'X', keyword: 'pest control', verdict: 'v', createdAt: '2026-11-25T00:00:00Z', offerDeadline: '2026-12-09' });
  assert.ok(!html.includes('<script>x'));
});

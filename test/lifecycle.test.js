const test = require('node:test');
const assert = require('node:assert');
const { termEnd, setTerm, resume, offboard } = require('../code/handlers/lifecycle');
const { runOne } = require('../code/worker');
const { alert } = require('../code/shared/alert');

const day = (d) => d.toISOString().slice(0, 10);

test('term end: 90 days for standard and ads rate, 12 months for the website plan', () => {
  assert.equal(day(termEnd('2026-11-28', 'standard')), '2027-02-26');
  assert.equal(day(termEnd('2026-11-28', 'ads_rate')), '2027-02-26');
  assert.equal(day(termEnd('2026-11-28', 'new_website')), '2027-11-28');
  assert.equal(day(termEnd('2028-02-29', 'new_website')), '2029-02-28'); // no Feb 29 next year
  assert.equal(day(termEnd('2026-01-31', 'new_website')), '2027-01-31');
});

test('setTerm writes plan name and a readable term end to GHL', async () => {
  const db = { async query() { return { rows: [{ id: 1, ghl_contact_id: 'c1', plan: 'new_website', start_date: '2026-11-28' }] }; } };
  const sent = [];
  const ghl = { async setFieldsByName(id, f) { sent.push([id, f]); } };
  const out = await setTerm({ db, job: { client_id: 1 }, deps: { ghl } });
  assert.equal(out.termEnd, '2027-11-28');
  assert.deepEqual(sent[0], ['c1', { 'Barrier - Plan Name': 'Blitz Barrier + New Website', 'Barrier - Term End': 'November 28, 2027' }]);
});

test('resume releases waiting jobs; offboard drops them', async () => {
  const sqls = [];
  const db = { async query(sql, params) { sqls.push([sql, params]); return { rows: [{ id: 5 }, { id: 6 }] }; } };
  assert.deepEqual(await resume({ db, job: { id: 9, client_id: 3 } }), { released: 2 });
  assert.match(sqls[0][0], /run_after = now\(\)/);
  assert.deepEqual(await offboard({ db, job: { id: 9, client_id: 3 } }), { dropped: 2 });
  assert.match(sqls[1][0], /status = 'done'/);
  assert.deepEqual(sqls[1][1], [3, 9]);
});

// A fake db for the worker: one claimed job, one client row, records the rest.
function workerDb(job, client) {
  const calls = [];
  let claimed = false;
  return {
    calls,
    async query(sql, params) {
      calls.push(sql);
      if (/update barrier.jobs set status = 'running'/.test(sql)) { if (claimed) return { rows: [] }; claimed = true; return { rows: [job] }; }
      if (/from barrier.clients/.test(sql)) return { rows: client ? [client] : [] };
      return { rows: [] };
    },
  };
}

test('worker: a paused client\'s job waits a day; a cancelled client\'s job is skipped; offboard still runs', async () => {
  let ran = 0;
  const list = { baseline_audit: async () => { ran++; return {}; }, offboard: async () => { ran++; return {}; } };
  let db = workerDb({ id: 1, type: 'baseline_audit', client_id: 2, attempts: 1, max_attempts: 3 }, { id: 2, status: 'paused' });
  await runOne(db, { list });
  assert.equal(ran, 0);
  assert.ok(db.calls.some((s) => /interval '1 day'/.test(s)));
  db = workerDb({ id: 1, type: 'baseline_audit', client_id: 2, attempts: 1, max_attempts: 3 }, { id: 2, status: 'cancelled' });
  await runOne(db, { list });
  assert.equal(ran, 0);
  assert.ok(db.calls.some((s) => /status = 'done'/.test(s)));
  db = workerDb({ id: 1, type: 'offboard', client_id: 2, attempts: 1, max_attempts: 3 }, { id: 2, status: 'cancelled' });
  await runOne(db, { list });
  assert.equal(ran, 1);
});

test('worker: a job that fails for good alerts Slack; a retry does not', async () => {
  const notes = [];
  const notify = async (ch, text) => notes.push([ch, text]);
  const list = { territory_scan: async () => { throw new Error('DataForSEO down'); } };
  const client = { id: 2, status: 'prospect', company: 'Bug Busters', ghl_contact_id: 'c1' };
  await runOne(workerDb({ id: 1, type: 'territory_scan', client_id: 2, attempts: 1, max_attempts: 3 }, client), { list, notify });
  assert.equal(notes.length, 0);
  await runOne(workerDb({ id: 1, type: 'territory_scan', client_id: 2, attempts: 3, max_attempts: 3 }, client), { list, notify });
  assert.equal(notes[0][0], 'prospects');
  assert.match(notes[0][1], /Territory Scan failed for Bug Busters.*DataForSEO down/);
});

test('alert without Slack set up only logs, and never throws', async () => {
  const out = await alert('clients', 'hello', { env: {} });
  assert.equal(out.sent, false);
  const bad = await alert('clients', 'hello', { env: { SLACK_BOT_TOKEN: 'x', SLACK_CHANNEL_CLIENT_MANAGEMENT: 'C1' }, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(bad.sent, false);
  const ok = await alert('clients', 'hello', { env: { SLACK_BOT_TOKEN: 'x', SLACK_CHANNEL_CLIENT_MANAGEMENT: 'C1' }, fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true }) }) });
  assert.equal(ok.sent, true);
});

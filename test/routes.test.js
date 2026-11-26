const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
process.env.BARRIER_SECRETS_KEY = crypto.randomBytes(32).toString('base64');
const { handle, planFromTags, redact } = require('../code/routes');
const { encrypt, decrypt } = require('../code/shared/secrets');

// A fake database that records every query and answers inserts with an id.
function fakeDb() {
  const calls = [];
  let id = 0;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const n = (sql.match(/\$\d+/g) || []).reduce((m, s) => Math.max(m, Number(s.slice(1))), 0);
      assert.equal(params.length, n, `parameter count for: ${sql.slice(0, 60)}`);
      return { rows: /returning/i.test(sql) ? [{ id: ++id, status: 'x' }] : [] };
    },
  };
}

test('client/create saves the event, the client and one baseline audit job', async () => {
  const db = fakeDb();
  const out = await handle(db, 'client/create', { contact_id: 'c1', company_name: 'Bug Busters', tags: 'barrier-purchased, barrier-rebuild' });
  assert.equal(out.status, 200);
  assert.match(db.calls[0].sql, /insert into barrier.events/);
  assert.match(db.calls[1].sql, /insert into barrier.clients/);
  assert.ok(db.calls[1].params.includes('new_website'));
  assert.match(db.calls[2].sql, /insert into barrier.jobs/);
  assert.equal(db.calls[2].params[0], 'baseline_audit');
});

test('client/update queues sub-account creation, the access check and the city check', async () => {
  const db = fakeDb();
  await handle(db, 'client/update', { contact_id: 'c1', 'Barrier - EIN': '123456789' });
  const types = db.calls.filter((c) => /barrier.jobs/.test(c.sql)).map((c) => c.params[0]);
  assert.deepEqual(types, ['create_subaccount', 'access_check', 'city_conflict_check']);
});

test('client/software never stores a key in plain text', async () => {
  const db = fakeDb();
  await handle(db, 'client/software', { contact_id: 'c1', 'Barrier - Job Software': 'GorillaDesk', 'Barrier - Software API Key': 'SUPERSECRETKEY' });
  for (const c of db.calls) assert.ok(!JSON.stringify(c.params).includes('SUPERSECRETKEY'), c.sql.slice(0, 50));
  const conn = db.calls.find((c) => /client_connections/.test(c.sql));
  assert.equal(JSON.parse(decrypt(conn.params[2])).key, 'SUPERSECRETKEY');
});

test('unknown path is 404, missing contact is 400', async () => {
  assert.equal((await handle(fakeDb(), 'nope', {})).status, 404);
  assert.equal((await handle(fakeDb(), 'client/create', {})).status, 400);
});

test('plan comes from the tags; redact blanks keys in customData too', () => {
  assert.equal(planFromTags({ tags: 'barrier-ads-rate' }), 'ads_rate');
  assert.equal(planFromTags({}), 'standard');
  const r = redact({ customData: { 'Barrier - Software API Token': 't' } });
  assert.equal(r.customData['Barrier - Software API Token'], '[redacted]');
  assert.equal(decrypt(encrypt('hello')), 'hello');
});

test('only standard and Barrier fields are kept from a GHL body', async () => {
  const db = fakeDb();
  await handle(db, 'territory-scan', { contact_id: 'c1', company_name: 'X', 'CRM Password': 'hunter2', 'Front Of Drivers License': 'url', 'Barrier - Registered City': 'Gig Harbor', customData: { city: 'Gig Harbor' } });
  for (const c of db.calls) assert.ok(!JSON.stringify(c.params).includes('hunter2'), c.sql.slice(0, 40));
  const ev = db.calls.find((c) => /barrier.events/.test(c.sql));
  const saved = JSON.parse(ev.params[3]);
  assert.equal(saved['Barrier - Registered City'], 'Gig Harbor');
  assert.equal(saved.customData.city, 'Gig Harbor');
  assert.equal(saved['Front Of Drivers License'], undefined);
});

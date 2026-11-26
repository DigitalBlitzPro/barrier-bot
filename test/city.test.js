const test = require('node:test');
const assert = require('node:assert');
const { normCity, cityHolders } = require('../code/shared/city');
const { cityConflictCheck } = require('../code/handlers/cityConflict');

test('cities compare loosely', () => {
  assert.equal(normCity('St. Petersburg, FL'), 'saint petersburg');
  assert.equal(normCity('saint petersburg'), 'saint petersburg');
  assert.equal(normCity('Tampa FL'), 'tampa');
  assert.equal(normCity('  Fort Myers '), 'fort myers');
  assert.equal(normCity('Ft. Myers, Florida'), 'fort myers');
  assert.equal(normCity(''), '');
});

const rowsDb = (rows) => ({ async query() { return { rows }; } });

test('cityHolders finds the same city held by another client', async () => {
  const db = rowsDb([{ id: 1, company: 'A', city: 'Tampa, FL' }, { id: 2, company: 'B', city: 'Orlando' }]);
  assert.deepEqual((await cityHolders(db, 'tampa')).map((r) => r.company), ['A']);
  assert.equal((await cityHolders(db, 'Miami')).length, 0);
});

test('a conflict tags the contact; no conflict does nothing', async () => {
  const tags = [];
  const ghl = { async addTags(id, t) { tags.push([id, ...t]); } };
  let call = 0;
  const db = { async query(sql) {
    call++;
    if (/where id = \$1/.test(sql)) return { rows: [{ id: 9, ghl_contact_id: 'c9', company: 'New Co', registered_city: 'Tampa' }] };
    return { rows: [{ id: 3, company: 'Old Co', city: 'Tampa, FL' }] };
  } };
  const out = await cityConflictCheck({ db, job: { client_id: 9 }, deps: { ghl } });
  assert.equal(out.conflict, true);
  assert.deepEqual(tags, [['c9', 'barrier-city-conflict']]);
});

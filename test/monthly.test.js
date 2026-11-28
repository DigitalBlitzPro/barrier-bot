const test = require('node:test');
const assert = require('node:assert');
const { dueFor, currentCycle, addMonths } = require('../code/scheduler');
const { analyze } = require('../code/shared/siteCheck');
const { safeWording, pickPages, pickQuestion, seasonOf } = require('../code/shared/writer');

const iso = (d) => d.toISOString().slice(0, 10);

test('addMonths clamps to the end of short months', () => {
  assert.equal(iso(addMonths(new Date('2026-01-31T00:00:00Z'), 1)), '2026-02-28');
  assert.equal(iso(addMonths(new Date('2026-11-28T00:00:00Z'), 2)), '2027-01-28');
});

test('currentCycle counts client months from kickoff', () => {
  const a = '2026-11-28T15:00:00Z';
  assert.equal(currentCycle(a, new Date('2026-12-10T00:00:00Z')).cycle, 0);
  assert.equal(currentCycle(a, new Date('2026-12-28T15:00:00Z')).cycle, 1);
  assert.equal(currentCycle(a, new Date('2027-03-01T00:00:00Z')).cycle, 3);
});

test('dueFor: work at month start, snapshot day 26, report day 27, nothing for inactive clients', () => {
  const c = { id: 7, status: 'active', activated_at: '2026-11-01T12:00:00Z' };
  assert.deepEqual(dueFor(c, new Date('2026-11-05T00:00:00Z')).map((j) => j.dedupeKey), ['7:work:0']);
  assert.deepEqual(dueFor(c, new Date('2026-11-27T13:00:00Z')).map((j) => j.dedupeKey), ['7:work:0', '7:snap:1']);
  assert.deepEqual(dueFor(c, new Date('2026-11-28T13:00:00Z')).map((j) => j.dedupeKey), ['7:work:0', '7:snap:1', '7:report:1']);
  assert.deepEqual(dueFor(c, new Date('2026-12-02T00:00:00Z')).map((j) => j.dedupeKey), ['7:work:1']);
  assert.deepEqual(dueFor({ ...c, status: 'paused' }, new Date('2026-11-05T00:00:00Z')), []);
  assert.deepEqual(dueFor({ ...c, activated_at: null }, new Date('2026-11-05T00:00:00Z')), []);
});

test('site check: a good page passes, a bare page lists plain fixes', () => {
  const good = `<html><head><title>Pest Control in Mesa, AZ | Bug Busters</title><meta name="description" content="Family-owned pest control in Mesa, AZ. Ants, scorpions, termites and rodents handled fast, with friendly techs.">
  <meta name="viewport" content="width=device-width"><script type="application/ld+json">{"@type":"PestControl"}</script></head><body><h1>Mesa pest control</h1>Call (480) 555-1212</body></html>`;
  const r = analyze({ html: good, status: 200, finalUrl: 'https://x.com/', ms: 900 }, { city: 'Mesa', phone: '480-555-1212', company: 'Bug Busters' });
  assert.equal(r.score, 100);
  const bad = analyze({ html: '<html><body>hi</body></html>', status: 200, finalUrl: 'http://x.com/', ms: 5200 }, { city: 'Mesa', phone: '4805551212' });
  const failed = bad.checks.filter((c) => !c.ok).map((c) => c.id);
  for (const id of ['https', 'speed', 'title', 'description', 'h1', 'phone', 'city', 'viewport', 'schema']) assert.ok(failed.includes(id), id);
  assert.ok(bad.score < 20);
});

test('writer swaps absolute safety claims unless the client approved wording', () => {
  assert.equal(safeWording('Our spray is 100% safe and non-toxic.'), 'Our spray is kid- and pet-friendly and family-friendly.');
  assert.equal(safeWording('Our spray is 100% safe.', 'EPA-registered, applied by licensed techs'), 'Our spray is 100% safe.');
});

test('writer picks growth services first, skips pages already written, rotates articles', () => {
  const c = { company: 'X', city: 'Mesa', services_offered: ['Ants', 'Termites', 'Other'], growth_services: ['Scorpions'], service_cities: ['Gilbert'] };
  assert.deepEqual(pickPages(c), [{ service: 'Scorpions', city: 'Mesa' }, { service: 'Ants', city: 'Mesa' }]);
  assert.deepEqual(pickPages(c, [{ service: 'Scorpions', city: 'Mesa' }, { service: 'Ants', city: 'Mesa' }, { service: 'Termites', city: 'Mesa' }]),
    [{ service: 'Scorpions', city: 'Gilbert' }, { service: 'Ants', city: 'Gilbert' }]);
  const q1 = pickQuestion([]);
  assert.notEqual(pickQuestion([q1]), q1);
  assert.equal(seasonOf(new Date('2026-11-28T00:00:00Z')), 'fall');
});

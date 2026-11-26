const test = require('node:test');
const assert = require('node:assert');
const { createServer, splitUrl, secretOk, pathFromWorkflow } = require('../code/server');

const SECRET = 'a'.repeat(32);

test('splitUrl reads the secret and path', () => {
  assert.deepEqual(splitUrl('/hook/s3cret/client/create'), { secret: 's3cret', path: 'client/create' });
  assert.deepEqual(splitUrl('/hook/s3cret/territory-scan/?x=1'), { secret: 's3cret', path: 'territory-scan' });
  assert.equal(splitUrl('/client/create'), null);
  assert.deepEqual(splitUrl('/hook/s3cret'), { secret: 's3cret', path: '' });
  assert.deepEqual(splitUrl('/hook/s3cret/'), { secret: 's3cret', path: '' });
  assert.deepEqual(splitUrl('/hook/s3cret%5Cterritory-scan'), { secret: 's3cret', path: 'territory-scan' });
  assert.deepEqual(splitUrl('/hook/s3cret\\territory-scan'), { secret: 's3cret', path: 'territory-scan' });
  assert.deepEqual(splitUrl('/hook/s3cret//client/create'), { secret: 's3cret', path: 'client/create' });
  assert.deepEqual(splitUrl('/hook%2Fs3cret%2Fterritory-scan'), { secret: 's3cret', path: 'territory-scan' });
  assert.deepEqual(splitUrl('/hook/s3cret%20/territory-scan'), { secret: 's3cret', path: 'territory-scan' });
});

test('secretOk refuses a wrong, short or missing secret', () => {
  process.env.BARRIER_WEBHOOK_SECRET = SECRET;
  assert.equal(secretOk(SECRET), true);
  assert.equal(secretOk('b'.repeat(32)), false);
  process.env.BARRIER_WEBHOOK_SECRET = 'short';
  assert.equal(secretOk('short'), false);
});

async function call(server, path, body) {
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

test('a good webhook reaches the handler; a bad secret does not', async () => {
  process.env.BARRIER_WEBHOOK_SECRET = SECRET;
  let ran = 0;
  const fake = async () => { ran++; return { status: 200, body: { ok: true } }; };
  const ok = await call(createServer({ runWithDb: fake }), `/hook/${SECRET}/client/create`, { contact_id: 'c1' });
  assert.equal(ok.status, 200);
  const bad = await call(createServer({ runWithDb: fake }), `/hook/${'b'.repeat(32)}/client/create`, { contact_id: 'c1' });
  assert.equal(bad.status, 401);
  assert.equal(ran, 1);
});

test('pathFromWorkflow places a call that arrived without a path', () => {
  const w = (name) => pathFromWorkflow({ workflow: { name } });
  assert.equal(w('BARRIER | S4 Territory Scan'), 'territory-scan');
  assert.equal(w('BARRIER | C1 Purchase'), 'client/create');
  assert.equal(w('BARRIER | C12 Software Connect'), 'client/software');
  assert.equal(w('BARRIER | C5b Kickoff Outcome'), 'client/activate');
  assert.equal(w('BARRIER | C8b Payment Recovered'), 'client/resume');
  assert.equal(w('BARRIER | C8 Payment Failed'), 'client/pause');
  assert.equal(w('BARRIER | Negative Review Approval'), 'review/approval');
  assert.equal(w('Something else'), null);
});

test('a call with only the Bot URL is routed by its workflow name', async () => {
  process.env.BARRIER_WEBHOOK_SECRET = SECRET;
  let seen = null;
  const fake = async (fn) => { seen = fn; return { status: 200, body: { ok: true } }; };
  const r = await call(createServer({ runWithDb: fake }), `/hook/${SECRET}`, { contact_id: 'c1', workflow: { name: 'BARRIER | S4 Territory Scan' } });
  assert.equal(r.status, 200);
  assert.ok(seen);
});

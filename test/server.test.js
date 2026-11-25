const test = require('node:test');
const assert = require('node:assert');
const { createServer, splitUrl, secretOk } = require('../code/server');

const SECRET = 'a'.repeat(32);

test('splitUrl reads the secret and path', () => {
  assert.deepEqual(splitUrl('/hook/s3cret/client/create'), { secret: 's3cret', path: 'client/create' });
  assert.deepEqual(splitUrl('/hook/s3cret/territory-scan/?x=1'), { secret: 's3cret', path: 'territory-scan' });
  assert.equal(splitUrl('/client/create'), null);
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

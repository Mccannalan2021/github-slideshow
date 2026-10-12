const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createAggregator } = require('../src/aggregator');
const { createMockProvider } = require('../src/providers/mock');
const keys = require('../src/keys');
const keysRoute = require('../src/routes/keys');

const KEY = 'test-key';
const SECRET = 'adzuna-secret-value-1234';
let server;
let base;
let dataDir;
let jobs;
let builtWith = null;

// Stands in for the real source builder: turns Adzuna on when its keys are present.
function sourceBuilder(env) {
  builtWith = env;
  if (env.ADZUNA_APP_KEY === 'explode') throw new Error(`bad key ${env.ADZUNA_APP_KEY}`);
  const list = [createMockProvider({ name: 'sample' })];
  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) list.push({ name: 'adzuna', searchJobs: async () => ({ total: 0, jobs: [] }) });
  return list;
}

async function call(method, url, body, key = KEY) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mccannfam-keys-'));
  const store = createStore(dataDir);
  jobs = createAggregator({ providers: [createMockProvider({ name: 'sample' })], store });
  server = createApp({ store, jobs, apiKey: KEY, env: {}, sourceBuilder });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('lists the sources and what is set, with none configured at first', async () => {
  const { status, body } = await call('GET', '/settings/keys');
  assert.equal(status, 200);
  assert.deepEqual(body.sources.map((s) => s.id), ['adzuna', 'jooble', 'jobbank', 'indeed']);
  assert.ok(body.sources.every((s) => !s.configured));
  assert.equal(body.canApplyNow, true);
});

test('keys need the API key', async () => {
  assert.equal((await call('GET', '/settings/keys', undefined, '')).status, 401);
  assert.equal((await call('PUT', '/settings/keys', { values: {} }, 'wrong')).status, 401);
});

test('rejects unknown, non-text, multi-line and half-filled keys', async () => {
  assert.match((await call('PUT', '/settings/keys', { values: { API_KEY: 'x' } })).body.error, /Unknown setting/);
  assert.equal((await call('PUT', '/settings/keys', { values: { JOOBLE_API_KEY: 5 } })).status, 400);
  assert.match((await call('PUT', '/settings/keys', { values: { JOOBLE_API_KEY: 'a\nb' } })).body.error, /single line/);
  assert.equal((await call('PUT', '/settings/keys', {})).status, 400);
  const half = await call('PUT', '/settings/keys', { values: { ADZUNA_APP_ID: 'abc' } });
  assert.equal(half.status, 400);
  assert.match(half.body.error, /Adzuna also needs: App key/);
  assert.equal(fs.existsSync(path.join(dataDir, 'keys.json')), false, 'nothing saved from a rejected request');
});

test('saves keys, switches sources on without a restart, and never returns the secret', async () => {
  const res = await call('PUT', '/settings/keys', { values: { ADZUNA_APP_ID: 'my-app-id', ADZUNA_APP_KEY: SECRET } });
  assert.equal(res.status, 200);
  const adzuna = res.body.sources.find((s) => s.id === 'adzuna');
  assert.equal(adzuna.configured, true);
  assert.equal(adzuna.fields.find((f) => f.key === 'ADZUNA_APP_ID').value, 'my-app-id');
  const secret = adzuna.fields.find((f) => f.key === 'ADZUNA_APP_KEY');
  assert.equal(secret.set, true);
  assert.equal(secret.preview, '••••1234');
  assert.equal(secret.value, undefined);
  assert.ok(!JSON.stringify(res.body).includes(SECRET), 'the secret is not in the response');
  assert.ok(!JSON.stringify((await call('GET', '/settings/keys')).body).includes(SECRET));

  assert.deepEqual(jobs.sources, ['sample', 'adzuna']);
  assert.deepEqual((await call('GET', '/health', undefined, '')).body.sources, ['sample', 'adzuna']);
  assert.equal(builtWith.ADZUNA_APP_KEY, SECRET);

  const file = path.join(dataDir, 'keys.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ADZUNA_APP_KEY, SECRET);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'keys file is private');
  assert.equal(createStore(dataDir).getKeys().ADZUNA_APP_ID, 'my-app-id', 'still there after a restart');
});

test('a key that fails to build a source is not saved and is not echoed back', async () => {
  const res = await call('PUT', '/settings/keys', { values: { ADZUNA_APP_KEY: 'explode' } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Could not use these keys/);
  assert.ok(!res.body.error.includes('explode'));
  assert.equal(createStore(dataDir).getKeys().ADZUNA_APP_KEY, SECRET, 'the working key is untouched');
  assert.deepEqual(jobs.sources, ['sample', 'adzuna']);
});

test('a Job Bank path that does not exist is rejected', async () => {
  const res = await call('PUT', '/settings/keys', { values: { JOBBANK_CSV: path.join(dataDir, 'nope.csv') } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not found/);
});

test('removes the saved keys for one source', async () => {
  assert.equal((await call('DELETE', '/settings/keys/nope')).status, 404);
  const res = await call('DELETE', '/settings/keys/adzuna');
  assert.equal(res.status, 200);
  assert.equal(res.body.sources.find((s) => s.id === 'adzuna').configured, false);
  assert.deepEqual(jobs.sources, ['sample']);
  assert.deepEqual(createStore(dataDir).getKeys(), {});
});

test('saved keys win over .env, and .env keys are shown as coming from .env', () => {
  const env = { JOOBLE_API_KEY: 'from-env-key-0000', ADZUNA_APP_ID: 'env-id' };
  const view = keys.describe(env, { ADZUNA_APP_ID: 'saved-id' });
  const adzunaId = view.find((s) => s.id === 'adzuna').fields[0];
  assert.deepEqual([adzunaId.value, adzunaId.from], ['saved-id', 'settings']);
  const jooble = view.find((s) => s.id === 'jooble');
  assert.equal(jooble.configured, true);
  assert.equal(jooble.fields[0].from, 'env');
  assert.equal(keys.effectiveEnv(env, { ADZUNA_APP_ID: 'saved-id' }).ADZUNA_APP_ID, 'saved-id');
});

test('without an API_KEY only this computer may change keys', () => {
  assert.equal(keysRoute.isLoopback('127.0.0.1'), true);
  assert.equal(keysRoute.isLoopback('::1'), true);
  assert.equal(keysRoute.isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(keysRoute.isLoopback('203.0.113.9'), false);
});

test('the settings page has the keys screen', async () => {
  const page = await (await fetch(`${base}/`)).text();
  assert.match(page, /id="settingsBox"/);
  assert.match(page, /\/settings\/keys/);
});

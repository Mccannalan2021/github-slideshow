// Drives the web-app client (client/jobs-api.js) against a real server.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createAggregator } = require('../src/aggregator');
const { createMockProvider } = require('../src/providers/mock');
const { loadConfig } = require('../src/config');

let server;
let base;
let dir;
let api;
let JobsApiError;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-'));
  const store = createStore(dir);
  const config = loadConfig({ overrides: { allowedOrigins: ['https://myjobs.app'] } });
  const gmail = { from: 'me@gmail.com', send: async () => ({ id: 'g1' }) };
  server = createApp({ store, jobs: createAggregator({ providers: [createMockProvider()], store, homeCity: 'Red Deer' }), config, gmail, apiKey: 'k' });
  await new Promise((r) => server.listen(0, r));
  server.unref();
  base = `http://localhost:${server.address().port}`;
  const client = await import('../client/jobs-api.js');
  JobsApiError = client.JobsApiError;
  api = client.createJobsApi({ baseUrl: `${base}/`, apiKey: 'k' });
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('client covers the swipe-app flow end to end', async () => {
  assert.deepEqual((await api.settings()).swipes.map((s) => s.pile), ['liked', 'superliked', 'passed']);
  await api.saveResume({ name: 'Jordan Smith', skills: ['sales', 'customer service'] });
  const pdf = new Blob([new TextEncoder().encode('%PDF-1.4 hi')], { type: 'application/pdf' });
  assert.equal((await api.uploadResumeFile(pdf, 'Jordan.pdf')).size, 11);

  const { cards, remaining } = await api.deck({ near: 'Red Deer', limit: 2 });
  assert.equal(cards.length, 2);
  assert.equal(cards[0].city, 'Red Deer');
  assert.ok(cards[0].reply.message);

  assert.equal((await api.swipe(cards[0].id, 'right')).pile, 'liked');
  await api.swipe(cards[1].id, 'left');
  assert.deepEqual(await api.piles(), { liked: 1, superliked: 0, passed: 1 });
  assert.equal((await api.deck({ near: 'Red Deer' })).remaining, remaining - 2);

  const liked = await api.pile('liked', { applied: false });
  assert.equal(liked[0].jobId, cards[0].id);
  const applied = await api.applyFromPile(cards[0].id);
  assert.equal(applied.applyUrl, cards[0].applyUrl);
  assert.equal((await api.applications('applied')).length, 1);

  const preview = await api.previewEmail('mock:5', { to: 'boss@earthworks.ca' });
  assert.equal(preview.attachment, 'Jordan.pdf');
  assert.equal((await api.emailJob('mock:5', { to: 'boss@earthworks.ca' })).sent, true);

  const search = await api.searchJobs({ region: 'Red Deer', sources: ['mock'], remote: false });
  assert.ok(search.jobs.every((j) => j.region === 'Red Deer'));
  const csv = await (await api.downloadCsv({ city: 'Calgary' })).text();
  assert.match(csv, /^title,company/);
});

test('client errors carry the status and message', async () => {
  await api.swipe('mock:3', 'left');
  await assert.rejects(api.swipe('mock:3', 'left'), (err) => err instanceof JobsApiError && err.status === 409 && /Already swiped/.test(err.message));
  const { createJobsApi } = await import('../client/jobs-api.js');
  await assert.rejects(createJobsApi({ baseUrl: base, apiKey: 'wrong' }).piles(), (err) => err.status === 401);
});

test('only allowed web app origins get browser access', async () => {
  const allowed = await fetch(`${base}/deck`, { method: 'OPTIONS', headers: { origin: 'https://myjobs.app' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://myjobs.app');
  assert.match(allowed.headers.get('access-control-allow-headers'), /x-api-key/);
  const other = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  assert.throws(() => loadConfig({ overrides: { allowedOrigins: ['https://myjobs.app/'] } }), /no trailing slash/);
});

test('serves an OpenAPI spec that covers every route', async () => {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.1.0');
  const documented = new Set(Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`)));
  const missing = server.routes
    .filter((r) => !['/', '/openapi.json'].includes(r.path))
    .map((r) => `${r.method} ${r.path}`)
    .filter((r) => !documented.has(r));
  assert.deepEqual(missing, [], 'every route is in the spec');
  assert.deepEqual(spec.paths['/swipes'].post.requestBody.content['application/json'].schema.properties.direction.enum, ['right', 'super', 'left']);
});

// Shows the API can be changed through config.json and drop-in route files.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createAggregator } = require('../src/aggregator');
const { createMockProvider } = require('../src/providers/mock');
const { loadConfig } = require('../src/config');

async function start(config, routeDirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mccannfam-custom-'));
  const store = createStore(dir);
  const jobs = createAggregator({ providers: [createMockProvider()], store, homeCity: config.homeCity });
  const server = createApp({ store, jobs, config, ...(routeDirs ? { routeDirs } : {}) });
  await new Promise((r) => server.listen(0, r));
  server.unref(); // a failed assertion can't leave the test run hanging
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { server, call, store, cleanup: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('new piles and card fields come straight from config', async () => {
  const config = loadConfig({
    overrides: {
      piles: { right: 'liked', left: 'passed', down: 'maybe' },
      deck: { size: 2, cardFields: ['id', 'title', 'applyUrl', 'salary'] },
    },
  });
  const { call, cleanup } = await start(config);

  const settings = await call('GET', '/settings');
  assert.deepEqual(settings.body.swipes, [
    { direction: 'right', pile: 'liked' }, { direction: 'left', pile: 'passed' }, { direction: 'down', pile: 'maybe' },
  ]);

  const deck = await call('GET', '/deck');
  assert.equal(deck.body.cards.length, 2);
  assert.deepEqual(Object.keys(deck.body.cards[0]), ['id', 'title', 'applyUrl', 'salary']);

  assert.equal((await call('POST', '/swipes', { jobId: deck.body.cards[0].id, direction: 'down' })).body.pile, 'maybe');
  assert.equal((await call('POST', '/swipes', { jobId: deck.body.cards[1].id, direction: 'super' })).status, 400, 'removed directions are rejected');
  assert.deepEqual((await call('GET', '/piles')).body, { liked: 0, passed: 0, maybe: 1 });
  assert.equal((await call('GET', '/piles/maybe')).body[0].title, deck.body.cards[0].title);
  assert.equal((await call('GET', '/swipes/stats')).body.maybe, 1);
  cleanup();
});

test('reply wording comes from config', async () => {
  const config = loadConfig({ overrides: { replies: { defaultTone: 'casual', tones: { casual: { greeting: 'Hey', closing: 'Cheers' } } } } });
  const { call, cleanup } = await start(config);
  await call('PUT', '/resume', { name: 'Sam Lee', skills: ['sales'] });
  const reply = await call('POST', '/jobs/mock:4/quick-reply', {});
  assert.match(reply.body.message, /^Hey,/);
  assert.match(reply.body.message, /Cheers,\nSam Lee/);
  cleanup();
});

test('dropping a file in a routes folder adds an endpoint', async () => {
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
  fs.writeFileSync(path.join(extra, 'hello.js'), `
    module.exports = ({ jobs }) => [
      { method: 'GET', path: '/hello/:name', handler: async ({ params }) => ({ hello: params.name, sources: jobs.sources }) },
    ];`);
  const { call, server, cleanup } = await start(loadConfig(), [path.join(__dirname, '..', 'src', 'routes'), extra]);
  assert.deepEqual((await call('GET', '/hello/red-deer')).body, { hello: 'red-deer', sources: ['mock'] });
  assert.ok(server.routes.some((r) => r.path === '/hello/:name' && r.file === 'hello.js'));
  cleanup();
  fs.rmSync(extra, { recursive: true, force: true });
});

test('config mistakes give clear errors', () => {
  assert.throws(() => loadConfig({ overrides: { deck: { cardFields: ['title', 'colour'] } } }), /unknown deck.cardFields: colour/);
  assert.throws(() => loadConfig({ overrides: { piles: { right: 'liked', left: 'liked' } } }), /every pile needs its own name/);
  assert.throws(() => loadConfig({ overrides: { replies: { defaultTone: 'pirate' } } }), /defaultTone "pirate"/);
  assert.throws(() => loadConfig({ overrides: { applicationStatuses: ['todo'] } }), /includes "applied"/);
});

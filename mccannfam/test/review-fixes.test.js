// Covers the fixes from the pull request review.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createAggregator, dedupe, normalizeJob } = require('../src/aggregator');
const { createMockProvider } = require('../src/providers/mock');
const { loadConfig } = require('../src/config');
const { toCsv } = require('../src/http');
const { applyInfo } = require('../src/contacts');

async function start({ gmail = null, config = loadConfig() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
  const store = createStore(dir);
  const jobs = createAggregator({ providers: [createMockProvider()], store });
  const server = createApp({ store, jobs, gmail, config });
  await new Promise((r) => server.listen(0, r));
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { call, dir, store, jobs, cleanup: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('CSV cells from postings cannot become spreadsheet formulas', () => {
  const csv = toCsv([{ title: '=HYPERLINK("http://x","Click")', company: '+1 Corp', note: 'a\rb', city: 'Red Deer' }], ['title', 'company', 'note', 'city']);
  assert.equal(csv.split('\n')[1], `"'=HYPERLINK(""http://x"",""Click"")",'+1 Corp,"a\rb",Red Deer`);
});

test('jobs outside Alberta cannot be fetched, swiped or emailed by id', async () => {
  const { call, jobs, cleanup } = await start();
  assert.equal(await jobs.getJob('mock:11'), null, 'mock:11 is in Vancouver');
  assert.equal((await call('POST', '/swipes', { jobId: 'mock:11', direction: 'right' })).status, 404);
  assert.equal((await call('GET', '/jobs/mock:3')).status, 200);
  cleanup();
});

test('duplicates keep contact details from either copy', () => {
  const a = normalizeJob({ id: '1', title: 'Cook', company: 'Diner', location: 'Banff, AB', description: 'A long description of the job here.', url: 'https://a' }, 'x');
  const b = normalizeJob({ id: '2', title: 'Cook', company: 'Diner', location: 'Banff, AB', description: 'Email jobs@diner.ca', url: 'https://b' }, 'y');
  const [merged] = dedupe([a, b]);
  assert.equal(merged.id, 'x:1');
  assert.equal(merged.applyEmail, 'jobs@diner.ca');
  assert.equal(merged.applyMethod, 'email');
});

test('phone numbers in the description are found', () => {
  assert.equal(applyInfo({ description: 'Call Sam at 403-555-0142 to apply.' }).applyPhone, '403-555-0142');
});

test('a damaged data file is reported instead of being overwritten', async () => {
  const { call, dir, cleanup } = await start();
  fs.writeFileSync(path.join(dir, 'applications.json'), '{ broken');
  assert.equal((await call('GET', '/applications')).status, 500);
  assert.equal(fs.readFileSync(path.join(dir, 'applications.json'), 'utf8'), '{ broken', 'file left untouched');
  cleanup();
});

test('simultaneous emails cannot pass the daily limit', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let sends = 0;
  const gmail = { from: 'a@gmail.com', send: async () => { sends++; await gate; return { id: `g${sends}` }; } };
  const { call, cleanup } = await start({ gmail, config: loadConfig({ overrides: { email: { dailyLimit: 2 } } }) });
  await call('PUT', '/resume', { name: 'Jordan Smith' });
  const pending = [1, 2, 3, 4].map(() => call('POST', '/jobs/mock:4/email', {}));
  await new Promise((r) => setTimeout(r, 50));
  release();
  const statuses = (await Promise.all(pending)).map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 201, 429, 429]);
  assert.equal(sends, 2);
  cleanup();
});

test('applying from a pile works even when cards leave out title, company and link', async () => {
  const config = loadConfig({ overrides: { deck: { cardFields: ['id', 'salary'] } } });
  const { call, cleanup } = await start({ config });
  await call('POST', '/swipes', { jobId: 'mock:3', direction: 'right' });
  const applied = await call('POST', '/swipes/mock:3/apply', {});
  assert.equal(applied.body.applyUrl, 'https://example.com/jobs/3');
  assert.equal(applied.body.application.title, 'Junior Software Developer');
  assert.equal(applied.body.application.company, 'Lakeview Tech');
  cleanup();
});

test('limit=all is reported as "all", and saved searches return the new run time', async () => {
  const { call, cleanup } = await start();
  assert.equal((await call('GET', '/jobs?limit=all')).body.limit, 'all');
  const saved = await call('POST', '/searches', { name: 'Calgary', filters: { city: 'Calgary' } });
  const run = await call('GET', `/searches/${saved.body.id}/run`);
  assert.ok(run.body.search.lastRunAt);
  assert.equal(run.body.search.previousRunAt, null);
  assert.equal((await call('GET', '/searches')).body[0].lastRunAt, run.body.search.lastRunAt);
  cleanup();
});

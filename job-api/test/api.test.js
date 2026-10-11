const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createAggregator } = require('../src/aggregator');
const { createMockProvider } = require('../src/providers/mock');

const KEY = 'test-key';
let server;
let base;
let dataDir;
let failingCalls = 0;

const failing = {
  name: 'broken',
  async searchJobs() {
    failingCalls++;
    throw new Error('upstream down');
  },
};

async function call(method, url, body, key = KEY) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-api-'));
  const store = createStore(dataDir);
  const jobs = createAggregator({ providers: [createMockProvider(), failing], store });
  server = createApp({ store, jobs, apiKey: KEY });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('rejects requests without the API key', async () => {
  assert.equal((await call('GET', '/jobs', null, null)).status, 401);
  assert.deepEqual((await call('GET', '/health', null, null)).body.sources, ['mock', 'broken']);
});

test('lists Alberta regions and cities', async () => {
  const r = await call('GET', '/alberta/cities');
  assert.equal(r.body.regions.length, 8);
  assert.ok(r.body.regions.find((g) => g.name === 'Calgary').cities.includes('Airdrie'));
});

test('searches all sources, keeps only Alberta jobs and removes duplicates', async () => {
  const r = await call('GET', '/jobs?limit=50');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 9);
  assert.deepEqual(r.body.removed, { outsideAlberta: 1, duplicates: 1 });
  assert.ok(!r.body.jobs.some((j) => j.location.includes('Vancouver')));

  const csr = r.body.jobs.find((j) => j.id === 'mock:2');
  assert.equal(csr.city, 'Edmonton');
  assert.equal(csr.region, 'Edmonton');
  assert.equal(csr.remote, true);
  assert.deepEqual(csr.alsoListedOn.map((a) => a.id), ['mock:10']);

  // A failing source is reported, not fatal.
  assert.deepEqual(r.body.sources.find((s) => s.name === 'broken'), { name: 'broken', ok: false, error: 'upstream down' });
});

test('normalizes salary to annual CAD and filters by it', async () => {
  const r = await call('GET', '/jobs?minSalary=80000&sort=salary');
  assert.deepEqual(r.body.jobs.map((j) => j.id), ['mock:8', 'mock:5', 'mock:3']);
  assert.equal(r.body.jobs[1].salaryMin, 38 * 2080);
});

test('filters by city, region, type, remote and keyword', async () => {
  const ids = async (qs) => (await call('GET', `/jobs?${qs}`)).body.jobs.map((j) => j.id).sort();
  assert.deepEqual(await ids('city=calgary'), ['mock:1', 'mock:3']);
  assert.deepEqual(await ids('region=Lethbridge'), ['mock:6', 'mock:9']);
  assert.deepEqual(await ids('type=seasonal'), ['mock:7']);
  assert.deepEqual(await ids('remote=true'), ['mock:2']);
  assert.deepEqual(await ids('q=truck'), ['mock:8']);
  assert.equal((await call('GET', '/jobs?city=Toronto')).status, 400);
  assert.equal((await call('GET', '/jobs?type=gig')).status, 400);
});

test('caches source results between searches', async () => {
  const before = failingCalls;
  const first = await call('GET', '/jobs?q=nurse');
  const second = await call('GET', '/jobs?q=nurse');
  assert.equal(first.body.sources[0].cached, false);
  assert.equal(second.body.sources[0].cached, true);
  assert.equal(failingCalls - before, 2, 'failed sources are retried, not cached');
});

test('pages results and returns facets', async () => {
  const r = await call('GET', '/jobs?limit=4&page=3&sort=date');
  assert.equal(r.body.pages, 3);
  assert.equal(r.body.jobs.length, 1);
  assert.equal(r.body.facets.cities.find((c) => c.value === 'Calgary').count, 2);

  const insights = await call('GET', '/insights?region=Calgary');
  assert.equal(insights.body.total, 2);
  assert.ok(insights.body.salary.medianMax > 0);
});

test('ranks by resume match and writes quick replies', async () => {
  assert.equal((await call('POST', '/jobs/mock:2/quick-reply', { type: 'apply' })).status, 409);

  const resume = await call('PUT', '/resume', {
    text: 'Jordan Smith\njordan@example.com | (555) 123-4567\nCustomer service rep with data entry, Microsoft Office and communication skills.',
    headline: 'Customer Service Representative',
  });
  assert.equal(resume.body.phone, '(555) 123-4567');

  const r = await call('GET', '/jobs');
  assert.equal(r.body.jobs[0].id, 'mock:2');
  assert.ok(r.body.jobs[0].match.score > r.body.jobs.at(-1).match.score);

  const reply = await call('POST', '/jobs/mock:2/quick-reply', {
    type: 'reply', employerMessage: 'Are you available for a phone interview this week?', availability: 'Tuesday after 1pm',
  });
  assert.equal(reply.body.intent, 'interview');
  assert.match(reply.body.message, /^Hello James,/);
  assert.match(reply.body.message, /available Tuesday after 1pm/);
  assert.equal((await call('POST', '/jobs/mock:2/quick-reply', { type: 'bogus' })).status, 400);
  assert.equal((await call('GET', '/jobs/mock:999')).status, 404);
});

test('saved searches flag new jobs', async () => {
  const created = await call('POST', '/searches', { name: 'Calgary jobs', filters: { city: 'Calgary' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.filters.city, 'Calgary');
  assert.equal((await call('POST', '/searches', { name: 'bad', filters: { city: 'Nowhere' } })).status, 400);

  const first = await call('GET', `/searches/${created.body.id}/run`);
  assert.equal(first.body.newCount, 2);
  const second = await call('GET', `/searches/${created.body.id}/run?onlyNew=true`);
  assert.equal(second.body.newCount, 0);
  assert.equal(second.body.jobs.length, 0);

  assert.equal((await call('DELETE', `/searches/${created.body.id}`)).status, 200);
  assert.equal((await call('GET', '/searches')).body.length, 0);
});

test('tracks applications', async () => {
  const created = await call('POST', '/applications', { jobId: 'mock:5', status: 'applied' });
  assert.equal(created.status, 201);
  assert.equal(created.body.company, 'Athabasca Earthworks');
  const updated = await call('PATCH', `/applications/${created.body.id}`, { status: 'interviewing' });
  assert.equal(updated.body.status, 'interviewing');
  assert.equal((await call('PATCH', `/applications/${created.body.id}`, { status: 'hired!' })).status, 400);
  assert.equal((await call('GET', '/applications?status=interviewing')).body.length, 1);
});

test('near= lists the home city first, then its region', async () => {
  const r = await call('GET', '/jobs?near=Red%20Deer&limit=50&match=false');
  assert.equal(r.body.filters.near, 'Red Deer');
  assert.equal(r.body.jobs[0].city, 'Red Deer');
  assert.equal(r.body.jobs[0].proximity, 'city');
  assert.equal(r.body.jobs[1].proximity, 'alberta');
  assert.ok(!('proximityRank' in r.body.jobs[0]));
  assert.equal((await call('GET', '/jobs?near=Gotham')).status, 400);
});

test('swipe deck: cards, right/left/super, undo and stats', async () => {
  const deck = await call('GET', '/deck?limit=3&near=Red%20Deer');
  assert.equal(deck.status, 200);
  assert.equal(deck.body.cards.length, 3);
  const [first, second, third] = deck.body.cards;
  assert.ok(first.reply.message.includes('Jordan Smith'), 'cards include a ready message');
  const remaining = deck.body.remaining;

  const right = await call('POST', '/swipes', { jobId: first.id, direction: 'right' });
  assert.equal(right.status, 201);
  assert.equal(right.body.application.status, 'applied');
  assert.equal(first.id, 'mock:4', 'Red Deer job comes first');
  assert.equal(right.body.next.action, 'email');
  assert.equal(right.body.next.to, 'hiring@mainstreetoutfitters.ca');
  assert.match(right.body.next.mailto, /^mailto:hiring@mainstreetoutfitters\.ca\?subject=Application%3A%20Retail%20Sales%20Associate/);
  assert.equal((await call('POST', '/swipes', { jobId: first.id, direction: 'left' })).status, 409);

  assert.equal((await call('POST', '/swipes', { jobId: second.id, direction: 'left' })).status, 201);
  const sup = await call('POST', '/swipes', { jobId: third.id, direction: 'super' });
  assert.equal(sup.body.application.starred, true);
  assert.equal((await call('POST', '/swipes', { jobId: third.id, direction: 'up' })).status, 400);

  const after = await call('GET', '/deck?limit=50&near=Red%20Deer');
  assert.equal(after.body.remaining, remaining - 3);
  assert.ok(!after.body.cards.some((c) => [first.id, second.id, third.id].includes(c.id)));

  const stats = await call('GET', '/swipes/stats');
  assert.deepEqual([stats.body.total, stats.body.right, stats.body.left, stats.body.super], [3, 1, 1, 1]);

  const undo = await call('POST', '/swipes/undo');
  assert.equal(undo.body.undone.jobId, third.id);
  assert.ok(!(await call('GET', '/applications')).body.some((a) => a.jobId === third.id), 'undo removes the application');
  assert.equal((await call('GET', '/deck?limit=50')).body.remaining, remaining - 2);
});

test('apply emails come through to cards, filters, quick replies and CSV', async () => {
  const csv = await fetch(`${base}/jobs.csv?city=Calgary`, { headers: { 'x-api-key': KEY } });
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  const text = await csv.text();
  assert.match(text.split('\n')[0], /^title,company,city,.*applyEmail/);
  assert.equal(text.trim().split('\n').length, 3);

  const page = await fetch(`${base}/`);
  assert.match(await page.text(), /<title>Alberta Jobs<\/title>/);
});

test('filters by apply email and puts it in quick replies', async () => {
  const withEmail = await call('GET', '/jobs?hasEmail=true');
  assert.deepEqual(withEmail.body.jobs.map((j) => j.applyEmail), ['hiring@mainstreetoutfitters.ca']);
  assert.equal(withEmail.body.facets.withApplyEmail, 1);
  const reply = await call('POST', '/jobs/mock:4/quick-reply', { type: 'apply' });
  assert.equal(reply.body.applyEmail, 'hiring@mainstreetoutfitters.ca');
  assert.match(reply.body.mailto, /^mailto:hiring@/);
  assert.equal((await call('POST', '/jobs/mock:5/quick-reply', { type: 'apply' })).body.mailto, null);
});

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createMockProvider } = require('../src/providers/mock');
const { createIndeedProvider } = require('../src/providers/indeed');
const { detectIntent } = require('../src/quickReply');

const KEY = 'test-key';
let server;
let base;
let dataDir;

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
  server = createApp({ store: createStore(dataDir), provider: createMockProvider(), apiKey: KEY });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('rejects requests without the API key', async () => {
  assert.equal((await call('GET', '/jobs', null, null)).status, 401);
  assert.equal((await call('GET', '/health', null, null)).status, 200);
});

test('quick reply requires a resume first', async () => {
  const r = await call('POST', '/jobs/mock-2/quick-reply', { type: 'apply' });
  assert.equal(r.status, 409);
});

test('saves a plain-text resume and extracts details', async () => {
  const r = await call('PUT', '/resume', {
    text: 'Jordan Smith\njordan@example.com | (555) 123-4567\nCustomer service rep with data entry, Microsoft Office and communication skills.',
    headline: 'Customer Service Representative',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Jordan Smith');
  assert.equal(r.body.email, 'jordan@example.com');
  assert.ok(r.body.skills.includes('customer service'));
  assert.ok(r.body.skills.includes('data entry'));
});

test('searches jobs ranked by resume match', async () => {
  const r = await call('GET', '/jobs');
  assert.equal(r.status, 200);
  assert.equal(r.body.jobs[0].id, 'mock-2');
  assert.ok(r.body.jobs[0].match.score > r.body.jobs.at(-1).match.score);

  const filtered = await call('GET', '/jobs?q=warehouse&location=dallas');
  assert.deepEqual(filtered.body.jobs.map((j) => j.id), ['mock-1']);
});

test('gets a job and its match', async () => {
  assert.equal((await call('GET', '/jobs/mock-3')).body.company, 'Lakeview Tech');
  assert.equal((await call('GET', '/jobs/nope')).status, 404);
  const m = await call('GET', '/jobs/mock-2/match');
  assert.ok(m.body.matchedSkills.includes('customer service'));
});

test('generates an application quick reply', async () => {
  const r = await call('POST', '/jobs/mock-2/quick-reply', { type: 'apply', tone: 'friendly' });
  assert.equal(r.status, 200);
  assert.match(r.body.message, /^Hi James,/);
  assert.match(r.body.message, /Customer Service Representative position at BrightPath Insurance/);
  assert.match(r.body.message, /Jordan Smith\n\(555\) 123-4567\njordan@example.com$/);
});

test('replies to an employer message based on its intent', async () => {
  const r = await call('POST', '/jobs/mock-2/quick-reply', {
    type: 'reply',
    employerMessage: 'Are you available for a phone interview this week?',
    availability: 'Tuesday or Thursday after 1pm',
  });
  assert.equal(r.body.intent, 'interview');
  assert.match(r.body.message, /available Tuesday or Thursday after 1pm/);

  assert.equal((await call('POST', '/jobs/mock-2/quick-reply', { type: 'reply' })).status, 400);
  assert.equal((await call('POST', '/jobs/mock-2/quick-reply', { type: 'bogus' })).status, 400);
});

test('detects common employer message intents', () => {
  assert.equal(detectIntent('What are your salary expectations?'), 'salary');
  assert.equal(detectIntent('When can you start?'), 'start');
  assert.equal(detectIntent('Unfortunately we are moving forward with other candidates'), 'rejection');
});

test('tracks applications', async () => {
  const created = await call('POST', '/applications', { jobId: 'mock-2', status: 'applied' });
  assert.equal(created.status, 201);
  assert.equal(created.body.company, 'BrightPath Insurance');

  const updated = await call('PATCH', `/applications/${created.body.id}`, { status: 'interviewing' });
  assert.equal(updated.body.status, 'interviewing');
  assert.equal((await call('PATCH', `/applications/${created.body.id}`, { status: 'hired!' })).status, 400);

  const list = await call('GET', '/applications?status=interviewing');
  assert.equal(list.body.length, 1);
});

test('indeed provider authenticates and maps jobs', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push(url);
    if (url.endsWith('/tokens')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    assert.equal(opts.headers.authorization, 'Bearer tok');
    return new Response(JSON.stringify({
      data: { jobSearch: { pageInfo: { nextCursor: 'c2' }, results: [{ job: {
        key: 'abc', title: 'Cook', employer: { name: 'Diner' }, location: { formatted: { long: 'Reno, NV' } },
      } }] } },
    }));
  };
  const indeed = createIndeedProvider({
    clientId: 'id', clientSecret: 'secret', tokenUrl: 'https://x/tokens', graphqlUrl: 'https://x/graphql',
  }, fakeFetch);

  const r = await indeed.searchJobs({ query: 'cook' });
  await indeed.searchJobs({ query: 'cook' });
  assert.equal(r.nextCursor, 'c2');
  assert.deepEqual(r.jobs[0], {
    id: 'abc', title: 'Cook', company: 'Diner', location: 'Reno, NV', salary: '', postedAt: '',
    description: '', url: 'https://www.indeed.com/viewjob?jk=abc', skills: [], source: 'indeed',
  });
  assert.equal(calls.filter((u) => u.endsWith('/tokens')).length, 1, 'token is cached');
});

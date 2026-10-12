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
  const call = async (method, url, body, raw) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: raw ?? (body && JSON.stringify(body)) });
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

test('two swipes on the same job at once give one swipe and one 409', async () => {
  const { call, cleanup } = await start();
  const results = await Promise.all([
    call('POST', '/swipes', { jobId: 'mock:3', direction: 'right' }),
    call('POST', '/swipes', { jobId: 'mock:3', direction: 'left' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await call('GET', '/swipes/stats')).body.total, 1);
  cleanup();
});

test('malformed resume entries are dropped instead of breaking job search', async () => {
  const { call, cleanup } = await start();
  const saved = await call('PUT', '/resume', {
    name: 'Jordan Smith',
    skills: ['sales', null, 7],
    experience: [null, 'oops', { company: 'No title' }, { title: 'Cashier', company: 'Store', duties: ['tills', null] }],
    education: [{ school: 'No credential' }, { credential: 'High School Diploma' }],
    certifications: ['First Aid', {}],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.skills, ['sales', '7']);
  assert.deepEqual(saved.body.experience, [{ title: 'Cashier', company: 'Store', duties: ['tills'] }]);
  assert.deepEqual(saved.body.education, [{ credential: 'High School Diploma' }]);
  assert.deepEqual(saved.body.certifications, ['First Aid']);
  assert.equal((await call('GET', '/jobs')).status, 200);
  cleanup();
});

test('card fields must be a list that includes the job id', () => {
  assert.throws(() => loadConfig({ overrides: { deck: { cardFields: ['title', 'salary'] } } }), /must include "id"/);
  assert.throws(() => loadConfig({ overrides: { deck: { cardFields: 'id,title' } } }), /must be a list/);
});

test('saved personal files are readable only by their owner', { skip: process.platform === 'win32' }, async () => {
  const { call, dir, cleanup } = await start();
  await call('PUT', '/resume', { name: 'Jordan Smith' });
  await call('PUT', '/resume/file', { filename: 'r.pdf', contentBase64: Buffer.from('%PDF').toString('base64') });
  for (const f of ['resume.json', 'resume-file.pdf', 'resume-file.json']) {
    assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  }
  cleanup();
});

test('fifth review: undo keeps applications, bodies must be objects, inputs normalised', async () => {
  const { call, cleanup } = await start();
  // Undo after applying keeps the application record.
  await call('POST', '/swipes', { jobId: 'mock:3', direction: 'right' });
  await call('POST', '/swipes/mock:3/apply', {});
  await call('POST', '/swipes/undo');
  assert.equal((await call('GET', '/applications')).body.length, 1);

  // Non-object bodies are a 400, not a 500.
  for (const raw of ['null', '[]', '5', '"x"']) {
    const r = await call('POST', '/swipes', undefined, raw);
    assert.equal(r.status, 400, `body ${raw}`);
    assert.equal(r.body.error, 'Body must be a JSON object');
  }

  // Scalar resume fields are strings, so matching can't crash.
  const saved = await call('PUT', '/resume', { name: 'A', headline: 7, summary: { x: 1 } });
  assert.equal(saved.body.headline, '7');
  assert.equal(saved.body.summary, '');
  assert.equal((await call('GET', '/jobs')).status, 200);

  // Empty status is rejected.
  const app = (await call('GET', '/applications')).body[0];
  assert.equal((await call('PATCH', `/applications/${app.id}`, { status: '' })).status, 400);

  // match=false skips matching in the deck but still reports the saved resume.
  const deck = await call('GET', '/deck?match=false&limit=1');
  assert.equal(deck.body.hasResume, true);
  assert.equal(deck.body.cards[0].match, null);
  assert.equal(deck.body.cards[0].reply, null);
  cleanup();
});

test('province codes after a comma count in any case', () => {
  const { isAlberta } = require('../src/alberta');
  assert.equal(isAlberta('Brooks, on'), false);
  assert.equal(isAlberta('Work on site in Red Deer'), true);
});

test('jobs with no employer are not merged as duplicates', () => {
  const a = normalizeJob({ id: '1', title: 'Cashier', company: '', location: 'Calgary, AB' }, 'x');
  const b = normalizeJob({ id: '2', title: 'Cashier', company: '', location: 'Calgary, AB' }, 'x');
  assert.equal(dedupe([a, b]).length, 2);
});

test('saved searches keep false filter values', async () => {
  const { call, cleanup } = await start();
  const saved = await call('POST', '/searches', { name: 'On site', filters: { remote: false } });
  assert.equal(saved.body.filters.remote, 'false');
  const run = await call('GET', `/searches/${saved.body.id}/run`);
  assert.ok(run.body.jobs.length > 0);
  assert.ok(run.body.jobs.every((j) => j.remote === false));
  cleanup();
});

test('unknown swipe directions such as "constructor" are rejected', async () => {
  const { call, cleanup } = await start();
  for (const direction of ['constructor', 'toString', '__proto__']) {
    assert.equal((await call('POST', '/swipes', { jobId: 'mock:3', direction })).status, 400, direction);
  }
  assert.equal((await call('GET', '/piles/constructor')).status, 404);
  cleanup();
});

test('replies only mention an attached resume when one is attached', () => {
  const { buildReply } = require('../src/quickReply');
  const job = { title: 'Welder', company: 'Steelco' };
  const resume = { name: 'Sam', skills: [] };
  assert.doesNotMatch(buildReply({ resume, job }).message, /attached/);
  assert.match(buildReply({ resume, job, attached: true }).message, /My resume is attached/);
});

test('.env values with quotes, backslashes and spaces read back exactly', () => {
  const { encodeEnvValue, decodeEnvValue, getEnvLine, setEnvLine } = require('../src/env');
  for (const v of ['C:\\Users\\me\\jobs.csv', 'Jordan "JJ" Smith', "O'Brien", 'plain', 'a b # c']) {
    assert.equal(decodeEnvValue(encodeEnvValue(v)), v);
    const lines = ['# comment', 'X=old'];
    setEnvLine(lines, 'X', v);
    assert.equal(getEnvLine(lines, 'X'), v);
    assert.equal(lines[0], '# comment');
  }
});

test('salary uses the pay amount, not other numbers in the text', () => {
  const { normalizeSalary } = require('../src/salary');
  assert.deepEqual(normalizeSalary({ text: '$18 per hour, 40 hours per week' }), { salaryMin: 37440, salaryMax: 37440 });
  assert.deepEqual(normalizeSalary({ text: '$30–$36 an hour' }), { salaryMin: 62400, salaryMax: 74880 });
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isAlberta, findCity } = require('../src/alberta');
const { normalizeSalary } = require('../src/salary');
const { detectIntent } = require('../src/quickReply');
const { createAdzunaProvider } = require('../src/providers/adzuna');
const { createJoobleProvider } = require('../src/providers/jooble');
const { createJobBankProvider } = require('../src/providers/jobbank');
const { createIndeedProvider } = require('../src/providers/indeed');

test('recognizes Alberta locations', () => {
  for (const loc of ['Calgary, AB', 'Edmonton, Alberta', 'Remote in Red Deer', 'Sherwood Park', 'Fort McMurray, AB T9H']) {
    assert.ok(isAlberta(loc), loc);
  }
  for (const loc of ['Vancouver, BC', 'Toronto, ON', 'Regina, Saskatchewan', 'Remote', 'Canada', 'Brooks, ON']) {
    assert.ok(!isAlberta(loc), loc);
  }
  assert.equal(findCity('St Albert, AB').name, 'St. Albert');
  assert.equal(findCity('Lake Louise, Alberta').region, 'Banff–Jasper–Rocky Mountain House');
});

test('normalizes salaries to annual', () => {
  assert.deepEqual(normalizeSalary({ text: '$18 - $21 an hour' }), { salaryMin: 37440, salaryMax: 43680 });
  assert.deepEqual(normalizeSalary({ text: '$42,000 a year' }), { salaryMin: 42000, salaryMax: 42000 });
  assert.deepEqual(normalizeSalary({ text: '$70k-$85k' }), { salaryMin: 70000, salaryMax: 85000 });
  assert.deepEqual(normalizeSalary({ text: '$4,000 per month' }), { salaryMin: 48000, salaryMax: 48000 });
  assert.deepEqual(normalizeSalary({ min: 25, max: 30, period: 'hour' }), { salaryMin: 52000, salaryMax: 62400 });
  assert.deepEqual(normalizeSalary({ text: 'Competitive' }), { salaryMin: null, salaryMax: null });
});

test('detects employer message intents', () => {
  assert.equal(detectIntent('What are your salary expectations?'), 'salary');
  assert.equal(detectIntent('When can you start?'), 'start');
  assert.equal(detectIntent('Unfortunately we are moving forward with other candidates'), 'rejection');
});

const json = (body) => async () => new Response(JSON.stringify(body));

test('maps Adzuna results', async () => {
  let requested;
  const adzuna = createAdzunaProvider({ appId: 'a', appKey: 'b' }, async (url) => {
    requested = new URL(url);
    return json({ count: 1, results: [{
      id: 42, title: '<strong>Welder</strong>', company: { display_name: 'Steelco' },
      location: { area: ['Canada', 'Alberta', 'Edmonton'], display_name: 'Edmonton' },
      salary_min: 60000, salary_max: 70000, created: '2026-10-01T00:00:00Z', redirect_url: 'https://adzuna/42',
      contract_time: 'full_time', category: { label: 'Trade & Construction Jobs' }, description: 'Weld.',
    }] })();
  });
  const r = await adzuna.searchJobs({ query: 'welder', location: 'Alberta' });
  assert.equal(requested.pathname, '/v1/api/jobs/ca/search/1');
  assert.equal(requested.searchParams.get('where'), 'Alberta');
  assert.equal(r.jobs[0].title, 'Welder');
  assert.equal(r.jobs[0].location, 'Edmonton, Alberta');
  assert.equal(r.jobs[0].type, 'full-time');
});

test('maps Jooble results', async () => {
  let sent;
  const jooble = createJoobleProvider({ apiKey: 'k' }, async (url, opts) => {
    sent = JSON.parse(opts.body);
    return json({ totalCount: 1, jobs: [{ id: 7, title: 'Cook', company: 'Diner', location: 'Banff, AB', salary: '$19 per hour', snippet: '<b>Cook</b> food', link: 'https://jooble/7', updated: '2026-10-02', type: 'Seasonal' }] })();
  });
  const r = await jooble.searchJobs({ query: 'cook', location: 'Alberta' });
  assert.equal(sent.location, 'Alberta');
  assert.equal(r.jobs[0].description, 'Cook food');
  assert.equal(r.jobs[0].salary, '$19 per hour');
});

test('loads Alberta rows from a Job Bank CSV', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbank-'));
  const file = path.join(dir, 'jobbank.csv');
  fs.writeFileSync(file, [
    'Job Posting ID,Job Title,Employer Name,City,Province/Territory,Salary Minimum,Salary Maximum,Salary Per,Employment Type,First Posting Date,NOC21 Title',
    '111,Welder,"Steel, Inc.",Calgary,Alberta,30,35,Hour,Full time,2026-09-30,Welders',
    '222,Cook,Diner,Regina,Saskatchewan,17,17,Hour,Part time,2026-09-30,Cooks',
    '333,"Heavy Duty ""HD"" Mechanic",Mine Co,Fort McMurray,AB,45,50,Hour,Full time,2026-09-29,Mechanics',
  ].join('\n'));
  const jb = createJobBankProvider({ csvPath: file });
  assert.equal(jb.size, 2);
  const r = await jb.searchJobs({ query: 'mechanic' });
  assert.equal(r.jobs[0].title, 'Heavy Duty "HD" Mechanic');
  assert.equal(r.jobs[0].location, 'Fort McMurray, Alberta');
  assert.equal(r.jobs[0].salaryPeriod, 'hour');
  assert.equal((await jb.getJob('111')).company, 'Steel, Inc.');
  assert.equal((await jb.getJob('111')).url, 'https://www.jobbank.gc.ca/jobsearch/jobposting/111');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Indeed provider authenticates once and maps jobs', async () => {
  const calls = [];
  const indeed = createIndeedProvider({ clientId: 'id', clientSecret: 's', tokenUrl: 'https://x/tokens', graphqlUrl: 'https://x/graphql' }, async (url, opts) => {
    calls.push(url);
    if (url.endsWith('/tokens')) return json({ access_token: 'tok', expires_in: 3600 })();
    assert.equal(opts.headers.authorization, 'Bearer tok');
    return json({ data: { jobSearch: { pageInfo: { nextCursor: 'c2' }, results: [{ job: { key: 'abc', title: 'Cook', employer: { name: 'Diner' }, location: { formatted: { long: 'Reno, NV' } } } }] } } })();
  });
  const r = await indeed.searchJobs({ query: 'cook' });
  await indeed.searchJobs({ query: 'cook' });
  assert.equal(r.jobs[0].company, 'Diner');
  assert.equal(calls.filter((u) => u.endsWith('/tokens')).length, 1);
});

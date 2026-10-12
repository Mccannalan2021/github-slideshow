const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createFileProvider } = require('../src/providers/file');
const { createAggregator } = require('../src/aggregator');

const block = (title, company, location, url, extra = '') => `**Job Title:** ${title}
            **Job Id:** JOBSEARCH_1
            **Company:** ${company}
            **Location:** ${location}
            **Posted on:** October 02, 2026
            **Job Type:** Permanent
            **Compensation:** ${extra || 'N/A'}
            **View Job URL:** ${url}
            `;

test('imports Indeed results into an Alberta snapshot and searches it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indeed-'));
  const input = path.join(dir, 'in');
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input, 'Calgary_AB__welder.md'), [
    block('Welder', 'Steelco', 'Calgary, AB', 'https://to.indeed.com/aaaa1111', '$30–$36 an hour'),
    block('Barista', 'Cafe', 'Vancouver, BC', 'https://to.indeed.com/bbbb2222'),
  ].join('\n'));
  // Same job found by a second search, wrapped the way the connector returns it.
  fs.writeFileSync(path.join(input, 'Alberta__trades.md'), JSON.stringify({ result: block('Welder', 'Steelco', 'Calgary, AB', 'https://to.indeed.com/aaaa1111') }));

  const out = path.join(dir, 'indeed.json');
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'import-indeed.js'), input, out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /1 outside Alberta, 1 unique Alberta jobs/);

  const data = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(data.source, 'indeed');
  assert.deepEqual(data.jobs[0], {
    id: 'aaaa1111', title: 'Welder', company: 'Steelco', location: 'Calgary, AB', postedAt: '2026-10-02',
    type: 'Permanent', salary: '$30–$36 an hour', url: 'https://to.indeed.com/aaaa1111', keywords: ['trades', 'welder'],
  });

  const provider = createFileProvider({ file: out });
  assert.equal(provider.name, 'indeed');
  assert.equal((await provider.searchJobs({ query: 'trades' })).jobs.length, 1, 'search keywords are matched');

  const agg = createAggregator({ providers: [provider], perSourceLimit: 0 });
  const r = await agg.search({ city: 'Calgary' });
  assert.equal(r.total, 1, 'file sources are not capped by perSourceLimit');
  assert.equal(r.jobs[0].id, 'indeed:aaaa1111');
  assert.equal(r.jobs[0].type, 'full-time');
  assert.equal(r.jobs[0].salaryMin, 30 * 2080);
  assert.equal(r.jobs[0].salaryMax, 36 * 2080);
  assert.deepEqual(agg.sourceDetails(), [{ name: 'indeed', kind: 'file', jobs: 1, fetchedAt: data.fetchedAt }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('imports ZipRecruiter results with dates, pay and remote flags', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  const input = path.join(dir, 'in');
  fs.mkdirSync(input);
  const result = (key, extra) => ({
    listing_key: key, title: 'Material Handler', company: 'P&H', location: 'Springbrook, Alberta', is_remote: false,
    salary: { min_annual: 60640, max_annual: null }, job_type: 'Full-time · On-site', benefits: 'Dental', days_ago: 2,
    job_redirect_url: `https://www.ziprecruiter.com/job-redirect?k=${key}`, ...extra,
  });
  fs.writeFileSync(path.join(input, 'a__o0.json'), JSON.stringify({ results: [result('k1'), result('k2', { location: 'Regina, Saskatchewan' })] }));
  fs.writeFileSync(path.join(input, 'b__o0.json'), JSON.stringify({ results: [result('k1'), result('k3', { title: 'Remote Agent', is_remote: true, location: 'Red Deer, Alberta', salary: null, job_type: 'Part-time, Full-time · Remote' })] }));
  fs.writeFileSync(path.join(input, 'broken.json'), '{not json');

  const out = path.join(dir, 'zip.json');
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'import-ziprecruiter.js'), input, out, '--fetched=2026-10-11'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /4 results, 1 outside Alberta, 2 unique Alberta jobs/);

  const agg = createAggregator({ providers: [createFileProvider({ file: out })] });
  const r = await agg.search({ limit: 'all' });
  const handler = r.jobs.find((j) => j.id === 'ziprecruiter:k1');
  assert.equal(handler.postedAt, '2026-10-09T00:00:00.000Z');
  assert.equal(handler.salaryMin, 60640);
  assert.equal(handler.type, 'full-time');
  assert.equal(handler.region, 'Red Deer');
  assert.equal(r.jobs.find((j) => j.id === 'ziprecruiter:k3').remote, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('daily imports add to the saved jobs and drop old ones', () => {
  const { writeSnapshot, postedWithin } = require('../scripts/snapshot');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
  const out = path.join(dir, 'jobs.json');
  const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  writeSnapshot(out, 'x', [{ id: 'old', title: 'Old', postedAt: day(40) }, { id: 'a', title: 'A', postedAt: day(3) }]);
  const r = writeSnapshot(out, 'x', [{ id: 'a', title: 'A updated', postedAt: day(3) }, { id: 'b', title: 'B', postedAt: day(0) }], { merge: true, keepDays: 30 });
  assert.deepEqual(r, { total: 2, added: 1, previous: 2, expired: 1 });
  const saved = JSON.parse(fs.readFileSync(out, 'utf8')).jobs;
  assert.deepEqual(saved.map((j) => [j.id, j.title]), [['b', 'B'], ['a', 'A updated']]);

  // "Last 1 day" keeps today and yesterday by date.
  assert.deepEqual(postedWithin([{ postedAt: day(0) }, { postedAt: day(1) }, { postedAt: day(2) }, {}], 1).length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

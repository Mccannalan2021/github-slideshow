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

#!/usr/bin/env node
// Imports every saved search result into the API's job files in one go:
//   raw/indeed/*        -> sources/indeed-alberta.json
//   raw/ziprecruiter/*  -> sources/ziprecruiter-alberta.json
// then prints how many jobs there are for Red Deer and Alberta, and how many are from the past week.
//
// Usage:
//   npm run import                 daily update: add jobs posted today or yesterday to the existing files
//   npm run import -- --full       rebuild the files from scratch with everything in raw/
// Jobs older than 30 days are dropped (change with --keep-days=N).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createFileProvider } = require('../src/providers/file');
const { createAggregator } = require('../src/aggregator');
const { parseArgs } = require('./snapshot');

const { flags } = parseArgs(process.argv.slice(2));
const full = flags.full === 'true';
const importFlags = full
  ? [`--keep-days=${flags['keep-days'] || 30}`]
  : ['--merge', `--since-days=${flags['since-days'] || 1}`, `--keep-days=${flags['keep-days'] || 30}`];

const root = path.join(__dirname, '..');
const IMPORTERS = [
  { name: 'indeed', script: 'import-indeed.js', raw: 'raw/indeed', out: 'sources/indeed-alberta.json' },
  { name: 'ziprecruiter', script: 'import-ziprecruiter.js', raw: 'raw/ziprecruiter', out: 'sources/ziprecruiter-alberta.json' },
];

async function main() {
  console.log(full ? 'Full import: rebuilding job files from raw/\n' : `Daily import: adding jobs posted in the last ${flags['since-days'] || 1} calendar day(s) (postings only carry a date)\n`);
  for (const imp of IMPORTERS) {
    const rawDir = path.join(root, imp.raw);
    const hasFiles = fs.existsSync(rawDir) && fs.readdirSync(rawDir).some((f) => /\.(md|json)$/.test(f));
    if (!hasFiles) {
      console.log(`${imp.name}: no saved results in ${imp.raw}/, skipped`);
      continue;
    }
    const run = spawnSync(process.execPath, [path.join(__dirname, imp.script), rawDir, path.join(root, imp.out), ...importFlags], { encoding: 'utf8' });
    process.stdout.write(`${imp.name}: ${run.stdout}`);
    if (run.status !== 0) {
      process.stderr.write(run.stderr);
      process.exit(1);
    }
  }

  // Summary across every snapshot, using the same Alberta filter and de-duplication as the API.
  const sourcesDir = path.join(root, 'sources');
  const files = fs.existsSync(sourcesDir) ? fs.readdirSync(sourcesDir).filter((f) => f.endsWith('.json')) : [];
  if (!files.length) return;
  const jobs = createAggregator({ providers: files.map((f) => createFileProvider({ file: path.join(sourcesDir, f) })) });
  const count = async (filters) => (await jobs.search({ ...filters, limit: 'all' })).total;
  const all = await jobs.search({ limit: 'all' });
  console.log(`
Jobs ready in the API (after removing duplicates across sites):
  Alberta:                  ${all.total}   (${await count({ postedWithin: 1 })} in the last 24 hours, ${await count({ postedWithin: 7 })} in the past week)
  Red Deer region:          ${await count({ region: 'Red Deer' })}   (${await count({ region: 'Red Deer', postedWithin: 1 })} in the last 24 hours, ${await count({ region: 'Red Deer', postedWithin: 7 })} in the past week)
  Red Deer city:            ${await count({ city: 'Red Deer' })}
  By site:                  ${all.facets.sources.map((s) => `${s.value} ${s.count}`).join(', ')}
`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

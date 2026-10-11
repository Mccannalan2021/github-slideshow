#!/usr/bin/env node
// Builds sources/indeed-alberta.json from saved Indeed search results (the markdown the Indeed
// connector returns: "**Job Title:** ...", "**Company:** ...", one block per job).
//
// Usage: node scripts/import-indeed.js <folder of .md results> [output file]
// Each file name should be "<location>__<keyword>.md"; the keyword is kept as a search hint.
const fs = require('node:fs');
const path = require('node:path');
const { isAlberta } = require('../src/alberta');

const [inputDir, outFile = path.join(__dirname, '..', 'sources', 'indeed-alberta.json')] = process.argv.slice(2);
if (!inputDir) {
  console.error('Usage: node scripts/import-indeed.js <folder> [output.json]');
  process.exit(1);
}

const FIELDS = {
  'Job Title': 'title', Company: 'company', Location: 'location', 'Posted on': 'postedAt',
  'Job Type': 'type', Compensation: 'salary', 'View Job URL': 'url',
};

function parseResults(text) {
  // Results arrive either as raw markdown or wrapped in {"result": "..."}.
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.result === 'string') text = parsed.result;
  } catch {
    // already markdown
  }
  return text.split(/(?=\*\*Job Title:\*\*)/).map((block) => {
    const job = {};
    for (const m of block.matchAll(/\*\*([^*]+):\*\*\s*(.*)/g)) {
      const key = FIELDS[m[1].trim()];
      if (key) job[key] = m[2].trim();
    }
    return job;
  }).filter((j) => j.title && j.url);
}

function idFromUrl(url) {
  const m = url.match(/[?&]jk=([\w]+)/) || url.match(/indeed\.com\/([\w]+)\/?$/);
  return m ? m[1] : Buffer.from(url).toString('base64url').slice(0, 16);
}

const files = fs.readdirSync(inputDir).filter((f) => f.endsWith('.md'));
const jobs = new Map();
let parsed = 0;
let outside = 0;

for (const file of files) {
  const keyword = (file.replace(/\.md$/, '').split('__')[1] || '').replace(/_/g, ' ').trim();
  for (const raw of parseResults(fs.readFileSync(path.join(inputDir, file), 'utf8'))) {
    parsed++;
    if (!isAlberta(raw.location)) {
      outside++;
      continue;
    }
    const id = idFromUrl(raw.url);
    const existing = jobs.get(id);
    if (existing) {
      if (keyword && !existing.keywords.includes(keyword)) existing.keywords.push(keyword);
      // Fill in anything the first copy was missing (e.g. salary shown in only one search).
      for (const k of ['company', 'type', 'salary']) {
        if (!existing[k] && raw[k] && raw[k] !== 'N/A') existing[k] = raw[k];
      }
      continue;
    }
    const postedAt = new Date(raw.postedAt);
    jobs.set(id, {
      id,
      title: raw.title,
      company: raw.company === 'N/A' ? '' : raw.company || '',
      location: raw.location,
      postedAt: Number.isNaN(postedAt.getTime()) ? '' : postedAt.toISOString().slice(0, 10),
      type: raw.type === 'N/A' ? '' : raw.type || '',
      salary: !raw.salary || raw.salary === 'N/A' ? '' : raw.salary,
      url: raw.url,
      keywords: keyword && !['jobs', 'jobs parttime', 'jobs contract', 'jobs temporary', 'jobs internship'].includes(keyword) ? [keyword] : [],
    });
  }
}

const list = [...jobs.values()].sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ source: 'indeed', fetchedAt: new Date().toISOString(), count: list.length, jobs: list }, null, 1));
console.log(`${files.length} searches, ${parsed} results, ${outside} outside Alberta, ${list.length} unique Alberta jobs -> ${outFile}`);

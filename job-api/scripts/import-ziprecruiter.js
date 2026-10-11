#!/usr/bin/env node
// Builds a job snapshot from saved ZipRecruiter search results (the JSON the ZipRecruiter
// connector returns: { "results": [{ "listing_key", "title", "company", ... }] }).
//
// Usage: node scripts/import-ziprecruiter.js <folder of .json results> [output file] [--fetched=YYYY-MM-DD]
//   [--merge] [--keep-days=N]   (see import-indeed.js)
// "days_ago" in each result is turned into a posting date counted back from the fetch date.
const fs = require('node:fs');
const path = require('node:path');
const { isAlberta } = require('../src/alberta');
const { writeSnapshot, postedWithin, parseArgs } = require('./snapshot');

const { flags, rest } = parseArgs(process.argv.slice(2));
const [inputDir, outFile = path.join(__dirname, '..', 'sources', 'ziprecruiter-alberta.json')] = rest;
if (!inputDir) {
  console.error('Usage: node scripts/import-ziprecruiter.js <folder> [output.json] [--fetched=YYYY-MM-DD]');
  process.exit(1);
}

function readResults(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    const data = JSON.parse(text);
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    console.warn(`Skipping ${path.basename(file)}: not valid JSON`);
    return [];
  }
}

const files = fs.readdirSync(inputDir).filter((f) => f.endsWith('.json'));
const jobs = new Map();
let seen = 0;
let outside = 0;

for (const file of files) {
  const fetchedAt = new Date(flags.fetched || fs.statSync(path.join(inputDir, file)).mtime);
  for (const r of readResults(path.join(inputDir, file))) {
    seen++;
    if (!r.listing_key || !r.title) continue;
    if (!isAlberta(r.location)) {
      outside++;
      continue;
    }
    if (jobs.has(r.listing_key)) continue;
    const posted = Number.isFinite(r.days_ago) ? new Date(fetchedAt.getTime() - r.days_ago * 86_400_000) : null;
    jobs.set(r.listing_key, {
      id: r.listing_key,
      title: r.title,
      company: r.company || '',
      location: r.location || '',
      postedAt: posted ? posted.toISOString().slice(0, 10) : '',
      // "Part-time, Full-time · On-site" -> type "Part-time, Full-time"
      type: String(r.job_type || '').split('·')[0].trim(),
      remote: Boolean(r.is_remote),
      salaryMin: r.salary?.min_annual ?? undefined,
      salaryMax: r.salary?.max_annual ?? undefined,
      salaryPeriod: r.salary ? 'year' : undefined,
      benefits: r.benefits || '',
      url: r.job_redirect_url || '',
    });
  }
}

const fresh = postedWithin([...jobs.values()], Number(flags['since-days']) || 0);
const result = writeSnapshot(outFile, 'ziprecruiter', fresh, { merge: flags.merge === 'true', keepDays: Number(flags['keep-days']) || 0 });
console.log(`${files.length} files, ${seen} results, ${outside} outside Alberta, ${jobs.size} unique Alberta jobs; ` +
  `${result.added} new, ${result.expired} expired, ${result.total} in file -> ${outFile}`);

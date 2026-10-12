// Shared by the importers: write a snapshot file, optionally merging into the one already there.
const fs = require('node:fs');
const path = require('node:path');

// Keeps only jobs posted within the last `days`, by calendar date: postings only carry a day, so
// "1 day" keeps today and yesterday. Jobs with no date are kept.
function postedWithin(jobs, days, now = Date.now()) {
  if (!days) return jobs;
  const cutoff = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  return jobs.filter((j) => !j.postedAt || String(j.postedAt).slice(0, 10) >= cutoff);
}

// merge: keep jobs already in the file and add/refresh the new ones (new data wins).
// keepDays: drop jobs older than this many days so the file doesn't grow forever.
function writeSnapshot(outFile, source, newJobs, { merge = false, keepDays = 0 } = {}) {
  const byId = new Map();
  let previous = 0;
  if (merge && fs.existsSync(outFile)) {
    const old = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    for (const j of old.jobs || []) byId.set(String(j.id), j);
    previous = byId.size;
  }
  let added = 0;
  for (const j of newJobs) {
    if (!byId.has(String(j.id))) added++;
    byId.set(String(j.id), { ...byId.get(String(j.id)), ...j });
  }
  const kept = postedWithin([...byId.values()], keepDays);
  const list = kept.sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ source, fetchedAt: new Date().toISOString(), count: list.length, jobs: list }, null, 1));
  return { total: list.length, added, previous, expired: byId.size - kept.length };
}

// Parses --flag=value arguments.
function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v = 'true'] = a.slice(2).split('=');
      flags[k] = v;
    } else rest.push(a);
  }
  return { flags, rest };
}

module.exports = { writeSnapshot, postedWithin, parseArgs };

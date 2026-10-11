// Serves jobs from a JSON snapshot file: { "source": "indeed", "fetchedAt": "...", "jobs": [...] }.
// Used for sources/indeed-alberta.json (built by scripts/import-indeed.js) and any other export
// you want to load. Each job needs at least id, title and location.
const fs = require('node:fs');

function createFileProvider({ file }) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const jobs = Array.isArray(data) ? data : data.jobs || [];
  const byId = new Map(jobs.map((j) => [String(j.id), j]));

  return {
    name: data.source || 'file',
    local: true,
    size: jobs.length,
    fetchedAt: data.fetchedAt || null,
    async searchJobs({ query = '' }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = jobs.filter((j) => {
        const hay = `${j.title} ${j.company} ${j.category || ''} ${(j.keywords || []).join(' ')} ${j.description || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      return { total: hits.length, jobs: hits };
    },
    async getJob(id) {
      return byId.get(String(id)) || null;
    },
  };
}

module.exports = { createFileProvider };

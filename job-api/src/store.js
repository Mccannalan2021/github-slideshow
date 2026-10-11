const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Small JSON-file store for the resume and the application tracker.
function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = (name) => path.join(dataDir, `${name}.json`);

  function read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  function write(name, value) {
    const tmp = `${file(name)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file(name));
    return value;
  }

  return {
    getResume: () => read('resume', null),
    saveResume: (resume) => write('resume', { ...resume, updatedAt: new Date().toISOString() }),

    listApplications: () => read('applications', []),
    getApplication: (id) => read('applications', []).find((a) => a.id === id) || null,
    addApplication(app) {
      const apps = read('applications', []);
      const now = new Date().toISOString();
      const created = { id: crypto.randomUUID(), status: 'saved', createdAt: now, updatedAt: now, ...app };
      write('applications', [...apps, created]);
      return created;
    },
    updateApplication(id, changes) {
      const apps = read('applications', []);
      const i = apps.findIndex((a) => a.id === id);
      if (i === -1) return null;
      apps[i] = { ...apps[i], ...changes, id, updatedAt: new Date().toISOString() };
      write('applications', apps);
      return apps[i];
    },

    deleteApplication(id) {
      const apps = read('applications', []);
      write('applications', apps.filter((a) => a.id !== id));
    },

    // Swiped jobs, sorted into piles by direction: { jobId, direction, at, card, appliedAt? }.
    listSwipes: () => read('swipes', []),
    addSwipe: (swipe) => write('swipes', [...read('swipes', []), { ...swipe, at: new Date().toISOString() }]).at(-1),
    updateSwipe(jobId, changes) {
      const all = read('swipes', []);
      const i = all.findIndex((x) => x.jobId === jobId);
      if (i === -1) return null;
      all[i] = { ...all[i], ...changes, jobId };
      write('swipes', all);
      return all[i];
    },
    removeSwipe(jobId) {
      const all = read('swipes', []);
      const rest = all.filter((x) => x.jobId !== jobId);
      write('swipes', rest);
      return rest.length !== all.length;
    },
    popSwipe() {
      const all = read('swipes', []);
      const last = all.pop();
      write('swipes', all);
      return last || null;
    },

    // Jobs seen in searches, so GET /jobs/:id and quick replies work for sources without a lookup API.
    getJobIndex: () => read('jobs-index', []),
    saveJobIndex: (jobs) => write('jobs-index', jobs),

    // Saved searches ("job alerts").
    listSearches: () => read('searches', []),
    getSearch: (id) => read('searches', []).find((s) => s.id === id) || null,
    addSearch(search) {
      const created = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), lastRunAt: null, seenIds: [], ...search };
      write('searches', [...read('searches', []), created]);
      return created;
    },
    updateSearch(id, changes) {
      const all = read('searches', []);
      const i = all.findIndex((s) => s.id === id);
      if (i === -1) return null;
      all[i] = { ...all[i], ...changes, id };
      write('searches', all);
      return all[i];
    },
    deleteSearch(id) {
      const all = read('searches', []);
      const rest = all.filter((s) => s.id !== id);
      write('searches', rest);
      return rest.length !== all.length;
    },
  };
}

module.exports = { createStore };

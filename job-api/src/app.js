// The HTTP server. Endpoints live in src/routes/ (one file per feature, loaded automatically) and
// settings live in config.json, so most changes never touch this file.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { createCardBuilder } = require('./cards');
const { HttpError, send, sendResult, created, file, html, readJson, safeEqual, matchPath } = require('./http');

const ROUTES_DIR = path.join(__dirname, 'routes');

function loadRoutes(ctx, dirs) {
  const routes = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
      const defs = require(path.join(dir, name))(ctx);
      for (const r of defs) {
        if (!r.method || !r.path || typeof r.handler !== 'function') {
          throw new Error(`${name}: every route needs method, path and handler`);
        }
        routes.push({ ...r, method: r.method.toUpperCase(), file: name });
      }
    }
  }
  // Exact paths beat :param paths, so "/swipes/undo" wins over "/swipes/:jobId".
  const params = (r) => r.path.split('/').filter((s) => s.startsWith(':')).length;
  return routes.sort((a, b) => params(a) - params(b));
}

function createApp({ store, jobs, apiKey, config = loadConfig(), routeDirs = [ROUTES_DIR] }) {
  const ctx = {
    store,
    jobs,
    config,
    toCard: createCardBuilder(config),
    HttpError,
    created,
    file,
    html,
    requireResume() {
      const resume = store.getResume();
      if (!resume) throw new HttpError(409, 'Upload your resume first with PUT /resume');
      return resume;
    },
    async requireJob(id) {
      const job = await jobs.getJob(id);
      if (!job) throw new HttpError(404, `Job ${id} not found`);
      return job;
    },
  };
  const routes = loadRoutes(ctx, routeDirs);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';

      let route = null;
      let params = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        params = matchPath(r.path, pathname);
        if (params) {
          route = r;
          break;
        }
      }
      if (!route) throw new HttpError(404, `No route for ${req.method} ${pathname}`);
      if (apiKey && !route.public && !safeEqual(req.headers['x-api-key'] || '', apiKey)) {
        throw new HttpError(401, 'Missing or invalid x-api-key header');
      }

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      sendResult(res, await route.handler({ params, query: url.searchParams, body, req }));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: status === 500 ? 'Internal server error' : err.message, ...(err.detail ? { detail: err.detail } : {}) });
    }
  });
  server.routes = routes.map(({ method, path: p, file: f }) => ({ method, path: p, file: f }));
  return server;
}

module.exports = { createApp };

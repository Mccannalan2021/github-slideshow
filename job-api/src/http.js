// Small HTTP toolkit shared by the routes: errors, JSON bodies, responses and path matching.
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Browser access (CORS): only the web app addresses in "allowedOrigins" may call the API.
// ["*"] allows any site. Set per request so the matching origin is echoed back.
function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  const allowAll = allowedOrigins.includes('*');
  if (allowAll) res.setHeader('access-control-allow-origin', '*');
  else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('access-control-allow-headers', 'content-type, x-api-key');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-expose-headers', 'content-disposition');
  res.setHeader('access-control-max-age', '600');
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

// Routes can return plain data (sent as JSON), created(data) for a 201, or file(...) for a download.
const created = (data) => ({ __status: 201, data });
const file = (content, { filename, type }) => ({ __file: true, content, filename, type });
const html = (content) => ({ __html: true, content });

function sendResult(res, result) {
  if (result && result.__file) {
    res.writeHead(200, { 'content-type': result.type, 'content-disposition': `attachment; filename="${result.filename}"` });
    return res.end(result.content);
  }
  if (result && result.__html) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(result.content);
  }
  if (result && result.__status) return send(res, result.__status, result.data);
  return send(res, 200, result);
}

async function readJson(req, maxBytes = 1_000_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) throw new HttpError(413, 'Request body too large');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Matches "/jobs/:id" style patterns; returns the params or null.
function matchPath(pattern, pathname) {
  const pp = pattern.split('/');
  const ap = pathname.split('/');
  if (pp.length !== ap.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    else if (pp[i] !== ap[i]) return null;
  }
  return params;
}

function toCsv(list, columns) {
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join('; ') : v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...list.map((j) => columns.map((c) => cell(j[c])).join(','))].join('\n');
}

module.exports = { HttpError, applyCors, send, sendResult, created, file, html, readJson, safeEqual, matchPath, toCsv };

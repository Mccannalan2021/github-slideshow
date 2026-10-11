// Government of Canada Job Bank open data.
// Download the monthly "Job Postings Advertised on Canada's National Job Bank Website" CSV from
// https://open.canada.ca/data/en/dataset/ea639e28-c0fc-48bf-b5dd-b8899bd43072 and point
// JOBBANK_CSV at the file (or a folder of them). Only Alberta rows are loaded.
// Columns are found by header name, so small changes between releases don't break the import.
const fs = require('node:fs');
const path = require('node:path');

const COLUMNS = {
  id: [/job.?posting.?id|posting.?id|^id$/i],
  title: [/job.?title/i, /^title$/i],
  company: [/employer.?(legal|operating)?.?name|^employer$/i, /company/i],
  province: [/province|prov.?terr/i],
  city: [/city|municipality|town/i],
  salary: [/salary$/i, /^wage$/i],
  salaryMin: [/salary.?min|minimum.?(salary|wage)/i],
  salaryMax: [/salary.?max|maximum.?(salary|wage)/i],
  period: [/salary.?per|wage.?per|per$/i],
  type: [/employment.?(type|term)|work.?term|hours/i],
  postedAt: [/first.?posting.?date|posting.?date|date.?posted/i],
  noc: [/noc.?(21)?.?(title|name)/i],
  url: [/url|link/i],
};

function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').slice(1);
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf).swap16().toString('utf16le').slice(1);
  return buf.toString('utf8').replace(/^﻿/, '');
}

// RFC 4180-style parser: handles quoted fields, escaped quotes and newlines inside quotes.
function parseCsv(text) {
  const firstLine = text.slice(0, text.indexOf('\n'));
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function mapColumns(header) {
  const map = {};
  for (const [key, patterns] of Object.entries(COLUMNS)) {
    for (const p of patterns) {
      const i = header.findIndex((h, idx) => p.test(h.trim()) && !Object.values(map).includes(idx));
      if (i !== -1) { map[key] = i; break; }
    }
  }
  return map;
}

function loadJobBank(csvPath) {
  const files = fs.statSync(csvPath).isDirectory()
    ? fs.readdirSync(csvPath).filter((f) => /\.(csv|tsv)$/i.test(f)).map((f) => path.join(csvPath, f))
    : [csvPath];
  const jobs = new Map();

  for (const file of files) {
    const [header, ...rows] = parseCsv(decode(fs.readFileSync(file)));
    if (!header) continue;
    const col = mapColumns(header);
    if (col.title === undefined || col.province === undefined) {
      throw new Error(`${path.basename(file)}: could not find job title and province columns in the Job Bank CSV`);
    }
    const get = (r, k) => (col[k] === undefined ? '' : (r[col[k]] || '').trim());

    rows.forEach((r, n) => {
      if (!/^(alberta|ab)$/i.test(get(r, 'province'))) return;
      const id = get(r, 'id') || `${path.basename(file)}-${n}`;
      const period = get(r, 'period');
      jobs.set(id, {
        id,
        title: get(r, 'title'),
        company: get(r, 'company'),
        location: [get(r, 'city'), 'Alberta'].filter(Boolean).join(', '),
        description: get(r, 'noc'),
        url: get(r, 'url') || (/^\d+$/.test(id) ? `https://www.jobbank.gc.ca/jobsearch/jobposting/${id}` : ''),
        postedAt: get(r, 'postedAt'),
        salary: get(r, 'salary') ? `${get(r, 'salary')}${period ? ` per ${period}` : ''}` : '',
        salaryMin: Number(get(r, 'salaryMin').replace(/[$,]/g, '')) || undefined,
        salaryMax: Number(get(r, 'salaryMax').replace(/[$,]/g, '')) || undefined,
        salaryPeriod: /hour/i.test(period) ? 'hour' : /week/i.test(period) ? 'week' : /month/i.test(period) ? 'month' : /year|annual/i.test(period) ? 'year' : undefined,
        type: get(r, 'type'),
        category: get(r, 'noc'),
      });
    });
  }
  return jobs;
}

function createJobBankProvider({ csvPath }) {
  if (!csvPath) throw new Error('Job Bank needs JOBBANK_CSV (path to the open data CSV file or folder)');
  const jobs = loadJobBank(csvPath);

  return {
    name: 'jobbank',
    local: true,
    size: jobs.size,
    async searchJobs({ query = '', limit = 50, page = 1 }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = [...jobs.values()].filter((j) => {
        const hay = `${j.title} ${j.company} ${j.category} ${j.location}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      if (!Number.isFinite(limit)) return { total: hits.length, jobs: hits };
      const start = (page - 1) * limit;
      return { total: hits.length, jobs: hits.slice(start, start + limit) };
    },
    async getJob(id) {
      return jobs.get(id) || null;
    },
  };
}

// Turned on when JOBBANK_CSV is set in .env.
function fromEnv(env) {
  if (!env.JOBBANK_CSV) return null;
  const provider = createJobBankProvider({ csvPath: path.resolve(env.JOBBANK_CSV) });
  console.log(`Job Bank: loaded ${provider.size} Alberta postings`);
  return provider;
}

module.exports = { fromEnv, createJobBankProvider, parseCsv, mapColumns };

#!/usr/bin/env node
// One-step setup for mccannfam:
//   1. checks your Node.js version
//   2. creates .env from .env.example
//   3. generates a strong API_KEY
//   4. asks for any job source keys you have (press Enter to skip)
//   5. runs the tests
//   6. optionally starts the server
//
// Usage:
//   npm run setup                 interactive
//   npm run setup -- --yes        no questions; takes keys from environment variables if set
//   npm run setup -- --start      start the server when done
//   npm run setup -- --new-key    replace an existing API_KEY
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPrompter } = require('./prompt');
const { getEnvLine, setEnvLine } = require('../src/env');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
const args = new Set(process.argv.slice(2));
const interactive = !args.has('--yes') && process.stdin.isTTY;

const SOURCES = [
  { name: 'Adzuna', url: 'https://developer.adzuna.com', keys: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'] },
  { name: 'Jooble', url: 'https://jooble.org/api/about', keys: ['JOOBLE_API_KEY'] },
  {
    name: 'Job Bank CSV',
    url: 'https://open.canada.ca/data/en/dataset/ea639e28-c0fc-48bf-b5dd-b8899bd43072',
    keys: ['JOBBANK_CSV'],
    validate: (v) => (fs.existsSync(path.resolve(root, v)) ? null : `File or folder not found: ${v}`),
  },
  { name: 'Indeed (partners only)', url: 'https://developer.indeed.com', keys: ['INDEED_CLIENT_ID', 'INDEED_CLIENT_SECRET', 'INDEED_SCOPE'] },
];

const ok = (msg) => console.log(`  ✔ ${msg}`);
const info = (msg) => console.log(`  - ${msg}`);
const fail = (msg) => {
  console.error(`  ✖ ${msg}`);
  process.exit(1);
};

// Minimal .env editor that keeps comments and ordering.
function readEnv() {
  return fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
}
const getVar = getEnvLine;
const setVar = setEnvLine;

async function main() {
  console.log('\nmccannfam setup\n');

  // 1. Node version
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail(`Node.js 18 or newer is required (you have ${process.versions.node}). Get it at https://nodejs.org`);
  ok(`Node.js ${process.versions.node}`);

  // 2. .env
  if (fs.existsSync(envPath)) ok('.env already exists, updating it');
  else {
    fs.copyFileSync(examplePath, envPath);
    ok('Created .env from .env.example');
  }
  const lines = readEnv();

  // 3. API key
  const currentKey = getVar(lines, 'API_KEY');
  if (!currentKey || currentKey === 'change-me' || args.has('--new-key')) {
    setVar(lines, 'API_KEY', crypto.randomBytes(24).toString('hex'));
    ok('Generated a new API_KEY');
  } else ok('Kept your existing API_KEY');

  // 4. Job sources
  const rl = interactive ? createPrompter() : null;
  console.log(interactive ? '\nJob sources (press Enter to skip any you don\'t have):' : '\nJob sources:');
  for (const source of SOURCES) {
    // Indeed's scope is optional, so it doesn't count towards "already configured".
    const existing = source.keys.filter((k) => k !== 'INDEED_SCOPE').every((k) => getVar(lines, k));
    if (existing) {
      ok(`${source.name}: already configured`);
      continue;
    }
    // Environment variables win, so --yes works in scripts and CI.
    // Only when every required key is there, so a half-configured source isn't switched on.
    const needed = source.keys.filter((k) => k !== 'INDEED_SCOPE');
    if (needed.every((k) => process.env[k])) {
      source.keys.filter((k) => process.env[k]).forEach((k) => setVar(lines, k, process.env[k]));
      ok(`${source.name}: taken from environment variables`);
      continue;
    }
    if (!rl) {
      info(`${source.name}: skipped (get access at ${source.url})`);
      continue;
    }
    console.log(`\n  ${source.name}  (${source.url})`);
    const values = {};
    for (const key of source.keys) {
      values[key] = (await rl.question(`    ${key}`)).trim();
      if (!values[key]) break;
      const problem = source.validate?.(values[key]);
      if (problem) {
        console.log(`    ${problem}. Skipping ${source.name}.`);
        values[key] = '';
        break;
      }
    }
    // Indeed's scope is optional; every other key is required for the source to work.
    const required = source.keys.filter((k) => k !== 'INDEED_SCOPE');
    if (required.every((k) => values[k])) {
      source.keys.forEach((k) => values[k] && setVar(lines, k, values[k]));
      ok(`${source.name}: saved`);
    } else info(`${source.name}: skipped`);
  }

  fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // Windows ignores file modes.
  }
  ok('Saved .env (readable only by you)');

  const enabled = SOURCES.filter((s) => s.keys.filter((k) => k !== 'INDEED_SCOPE').every((k) => getVar(lines, k)));
  if (!enabled.length) info('No job sources configured yet: the API will serve sample Alberta jobs. Re-run setup any time to add keys.');

  // 5. Tests
  console.log('\nRunning tests...');
  const testDir = path.join(root, 'test');
  const tests = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(testDir, f));
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=dot', ...tests], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) fail('Tests failed. Fix the errors above before starting the server.');
  ok('All tests passed');

  // 6. Summary and start
  const port = getVar(lines, 'PORT') || '3000';
  const apiKey = getVar(lines, 'API_KEY');
  console.log(`
Setup complete.

  Sources:  ${enabled.length ? enabled.map((s) => s.name).join(', ') : 'sample jobs'}
  API key:  ${apiKey}
            (your job app sends this in the "x-api-key" header; it's stored in .env)

  Start the server:  npm start
  Try a search:      curl "http://localhost:${port}/jobs?city=Calgary" -H "x-api-key: ${apiKey}"
`);

  let start = args.has('--start');
  if (!start && rl) start = await rl.yesNo('Start the server now?');
  rl?.close();
  if (start) require('../src/server');
}

main().catch((err) => fail(err.message));

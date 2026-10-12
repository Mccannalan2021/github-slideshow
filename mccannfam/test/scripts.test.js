// Runs the setup script for real in a scratch copy of the project.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

test('every script parses', () => {
  for (const f of fs.readdirSync(path.join(root, 'scripts')).filter((n) => n.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', path.join(root, 'scripts', f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('setup only uses a source from environment variables when all its keys are set', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
  for (const f of ['package.json', 'config.json', '.env.example']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['scripts', 'src']) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test')); // setup runs the tests; give it an empty folder here

  const env = { ...process.env, ADZUNA_APP_ID: 'onlyid', JOOBLE_API_KEY: 'jk' };
  delete env.ADZUNA_APP_KEY;
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'setup.js'), '--yes'], { cwd: dir, env, encoding: 'utf8' });
  assert.match(r.stdout, /Adzuna: skipped/);
  assert.match(r.stdout, /Jooble: taken from environment variables/);
  const saved = fs.readFileSync(path.join(dir, '.env'), 'utf8');
  assert.match(saved, /^ADZUNA_APP_ID=$/m);
  assert.match(saved, /^JOOBLE_API_KEY=jk$/m);
  assert.doesNotMatch(saved, /^API_KEY=change-me$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { createAggregator } = require('../src/aggregator');
const { createMockProvider } = require('../src/providers/mock');
const { loadConfig } = require('../src/config');
const { createGmail, buildMime } = require('../src/gmail');

async function start({ gmail = null, config = loadConfig() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-'));
  const store = createStore(dir);
  const jobs = createAggregator({ providers: [createMockProvider()], store });
  const server = createApp({ store, jobs, gmail, config });
  await new Promise((r) => server.listen(0, r));
  server.unref();
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { call, store, cleanup: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('builds a proper email with the resume attached', () => {
  const mime = buildMime({
    from: 'me@gmail.com', fromName: 'Jordan Smith', to: 'hr@acme.ca', subject: 'Application: Welder – Jordan',
    text: 'Hello,\nI am applying.', attachments: [{ filename: 'Resume.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }],
  });
  assert.match(mime, /^From: Jordan Smith <me@gmail.com>\r\nTo: hr@acme.ca\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-Disposition: attachment; filename="Resume.pdf"/);
  assert.ok(mime.includes(Buffer.from('Hello,\nI am applying.').toString('base64')));
  assert.throws(() => buildMime({ from: 'a@b.ca', to: 'x@y.ca', subject: 'Hi\r\nBcc: evil@x.ca', text: '' }), /line breaks/);
});

test('Gmail client signs in once and sends through the Gmail API', async () => {
  const calls = [];
  const gmail = createGmail({ clientId: 'id', clientSecret: 's', refreshToken: 'r', from: 'me@gmail.com' }, async (url, opts) => {
    calls.push(url);
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    assert.equal(opts.headers.authorization, 'Bearer tok');
    const raw = Buffer.from(JSON.parse(opts.body).raw, 'base64url').toString();
    assert.match(raw, /To: hr@acme.ca/);
    return new Response(JSON.stringify({ id: 'm1', threadId: 't1' }));
  });
  assert.deepEqual(await gmail.send({ to: 'hr@acme.ca', subject: 'Hi', text: 'Body' }), { id: 'm1', threadId: 't1' });
  await gmail.send({ to: 'hr@acme.ca', subject: 'Hi', text: 'Body' });
  assert.equal(calls.filter((u) => u.includes('oauth2')).length, 1);
  await assert.rejects(gmail.send({ to: 'not-an-email', subject: 'x', text: 'y' }), /not a valid email/);
});

test('emails an application from Gmail with the resume attached', async () => {
  const sent = [];
  const gmail = { from: 'jordan@gmail.com', send: async (msg) => { sent.push(msg); return { id: `g${sent.length}` }; } };
  const { call, store, cleanup } = await start({ gmail });

  assert.deepEqual((await call('GET', '/email/status')).body, { connected: true, from: 'jordan@gmail.com', sentToday: 0, dailyLimit: 40, resumeFile: null });
  assert.equal((await call('POST', '/jobs/mock:4/email', {})).status, 409, 'needs a resume');

  await call('PUT', '/resume', { name: 'Jordan Smith', skills: ['sales'] });
  const pdf = Buffer.from('%PDF-1.4 resume').toString('base64');
  assert.equal((await call('PUT', '/resume/file', { filename: 'Jordan Smith.pdf', contentBase64: pdf })).body.filename, 'Jordan Smith.pdf');
  assert.equal((await call('PUT', '/resume/file', { filename: 'resume.exe', contentBase64: pdf })).status, 400);

  // Preview does not send.
  const preview = await call('POST', '/jobs/mock:4/email', { preview: true });
  assert.equal(preview.body.to, 'hiring@mainstreetoutfitters.ca');
  assert.equal(preview.body.attachment, 'Jordan Smith.pdf');
  assert.equal(sent.length, 0);

  // Swipe it into a pile, then send.
  await call('POST', '/swipes', { jobId: 'mock:4', direction: 'right' });
  const r = await call('POST', '/jobs/mock:4/email', {});
  assert.equal(r.status, 201);
  assert.equal(r.body.gmailId, 'g1');
  assert.equal(sent[0].to, 'hiring@mainstreetoutfitters.ca');
  assert.match(sent[0].subject, /^Application: Retail Sales Associate/);
  assert.equal(sent[0].attachments[0].filename, 'Jordan Smith.pdf');
  assert.equal(sent[0].attachments[0].content.toString(), '%PDF-1.4 resume');
  assert.equal(r.body.application.method, 'email');
  assert.ok((await call('GET', '/piles/liked?applied=true')).body.some((j) => j.jobId === 'mock:4'), 'marked applied in the pile');
  assert.equal((await call('GET', '/email/sent')).body.length, 1);

  // Jobs without an email need "to".
  assert.equal((await call('POST', '/jobs/mock:5/email', {})).status, 400);
  assert.equal((await call('POST', '/jobs/mock:5/email', { to: 'boss@earthworks.ca' })).status, 201);
  assert.equal(store.listEmails().length, 2);
  cleanup();
});

test('email limits and missing Gmail are reported clearly', async () => {
  const noGmail = await start();
  await noGmail.call('PUT', '/resume', { name: 'Jordan Smith' });
  const r = await noGmail.call('POST', '/jobs/mock:4/email', {});
  assert.equal(r.status, 503);
  assert.match(r.body.error, /npm run gmail/);
  assert.equal((await noGmail.call('POST', '/jobs/mock:4/email', { preview: true })).status, 200, 'preview works without Gmail');
  noGmail.cleanup();

  const gmail = { from: 'a@gmail.com', send: async () => ({ id: 'x' }) };
  const limited = await start({ gmail, config: loadConfig({ overrides: { email: { dailyLimit: 1 } } }) });
  await limited.call('PUT', '/resume', { name: 'Jordan Smith' });
  assert.equal((await limited.call('POST', '/jobs/mock:4/email', {})).status, 201);
  assert.equal((await limited.call('POST', '/jobs/mock:4/email', {})).status, 429);
  limited.cleanup();
});

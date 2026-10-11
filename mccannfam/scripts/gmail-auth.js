#!/usr/bin/env node
// Connects your Gmail account so the API can send application emails from it.
// Asks for a Google OAuth client, opens Google's sign-in, and saves the GMAIL_* settings to .env.
// Permission requested: gmail.send only (send as you; it cannot read your inbox).
//
// Usage: npm run gmail
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createPrompter, loadEnv } = require('./prompt');
const { createGmail, EMAIL } = require('../src/gmail');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function saveEnv(values) {
  if (!fs.existsSync(envPath)) fs.copyFileSync(path.join(root, '.env.example'), envPath);
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`;
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i === -1) lines.push(line);
    else lines[i] = line;
  }
  fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
}

// Listens on http://127.0.0.1:<random port>/ for Google's redirect with the sign-in code.
async function startCallbackServer(state) {
  let done;
  const code = new Promise((resolve, reject) => { done = { resolve, reject }; });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/') return res.writeHead(404).end();
    const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(ok ? '<h2>Gmail connected.</h2><p>You can close this tab and go back to the terminal.</p>' : '<h2>Sign-in failed.</h2><p>Go back to the terminal.</p>');
    server.close();
    if (ok) done.resolve(url.searchParams.get('code'));
    else done.reject(new Error(url.searchParams.get('error') || 'Sign-in was cancelled or did not match'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, code };
}

async function main() {
  loadEnv();
  const ask = createPrompter();
  console.log(`
Connect Gmail

One-time setup in Google Cloud (about 5 minutes, free):
  1. Go to https://console.cloud.google.com and create a project (any name).
  2. APIs & Services > Library: search "Gmail API" and click Enable.
  3. APIs & Services > OAuth consent screen: choose External, fill in the app name and your email,
     and under Test users add your own Gmail address.
  4. APIs & Services > Credentials > Create credentials > OAuth client ID > Application type:
     Desktop app. Copy the Client ID and Client secret.
`);
  const clientId = await ask.question('Client ID', process.env.GMAIL_CLIENT_ID);
  const clientSecret = await ask.question('Client secret', process.env.GMAIL_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error('Client ID and secret are required.');

  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const { port, code: codePromise } = await startCallbackServer(state);
  const redirectUri = `http://127.0.0.1:${port}`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  })}`;

  console.log(`\nOpen this link in your browser on this computer and sign in with the Gmail you want to send from:\n\n  ${authUrl}\n`);
  console.log('Google may warn that the app is unverified: click Advanced > Go to (your app). It is your own app.');
  console.log('Waiting for you to finish signing in...');
  const code = await codePromise;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const tokens = await res.json();
  if (!res.ok || !tokens.refresh_token) throw new Error(`Google did not return access: ${tokens.error_description || tokens.error || res.status}`);

  let from = await ask.question('\nThe Gmail address you just signed in with', process.env.GMAIL_FROM);
  while (!EMAIL.test(from)) from = await ask.question('Please enter a valid email address');
  const fromName = await ask.question('Your name as it should appear on emails', process.env.GMAIL_FROM_NAME);

  saveEnv({ GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret, GMAIL_REFRESH_TOKEN: tokens.refresh_token, GMAIL_FROM: from, GMAIL_FROM_NAME: fromName });
  console.log('\n✔ Gmail connected and saved to .env');

  if (await ask.yesNo(`Send a test email to ${from}?`, true)) {
    const gmail = createGmail({ clientId, clientSecret, refreshToken: tokens.refresh_token, from, fromName });
    await gmail.send({ to: from, subject: 'mccannfam: Gmail is connected', text: 'Your job app can now send applications from this Gmail account.' });
    console.log('✔ Test email sent. Check your inbox.');
  }
  console.log(`
Note: while your Google app is in "Testing", Google expires this access after 7 days.
Run npm run gmail again when sending stops working, or publish the app on the OAuth consent
screen (it stays unverified, which is fine for your own use) so it lasts.`);
  ask.close();
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});

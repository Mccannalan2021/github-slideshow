// Sends email from your own Gmail account through the Gmail API.
// Connect once with `npm run gmail` (scripts/gmail-auth.js); it saves GMAIL_* settings to .env.
// Uses the narrow "gmail.send" permission: the API can send mail as you but cannot read your inbox.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;

const b64 = (data) => Buffer.from(data).toString('base64');
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');
// Encodes non-ASCII header text (names, subjects) so every mail client shows it correctly.
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

function clean(value, label) {
  const s = String(value || '');
  if (/[\r\n]/.test(s)) throw new Error(`${label} cannot contain line breaks`);
  return s.trim();
}

// Builds a standard email (RFC 5322 / MIME) with an optional attachment.
function buildMime({ from, fromName, to, subject, text, attachments = [] }) {
  const boundary = `job-api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const fromHeader = fromName ? `${header(clean(fromName, 'Name'))} <${from}>` : from;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${header(clean(subject, 'Subject'))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
  ];
  for (const a of attachments) {
    const name = clean(a.filename, 'Attachment name').replace(/"/g, '');
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(b64(a.content)),
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

function createGmail({ clientId, clientSecret, refreshToken, from, fromName = '' }, fetchImpl = fetch) {
  if (!clientId || !clientSecret || !refreshToken || !from) {
    throw new Error('Gmail needs GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN and GMAIL_FROM (run npm run gmail)');
  }
  let token = null;
  let expiresAt = 0;

  async function accessToken() {
    if (token && Date.now() < expiresAt - 60_000) return token;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error === 'invalid_grant'
        ? 'Gmail access expired or was removed. Run npm run gmail to reconnect.'
        : `Gmail sign-in failed (${res.status})`);
      err.status = 502;
      throw err;
    }
    token = data.access_token;
    expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return token;
  }

  return {
    from,
    async send({ to, subject, text, attachments }) {
      const recipient = clean(to, 'To');
      if (!EMAIL.test(recipient)) {
        const err = new Error(`"${recipient}" is not a valid email address`);
        err.status = 400;
        throw err;
      }
      const raw = Buffer.from(buildMime({ from, fromName, to: recipient, subject, text, attachments })).toString('base64url');
      const res = await fetchImpl(SEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(`Gmail could not send the email (${res.status}): ${data.error?.message || 'unknown error'}`);
        err.status = 502;
        throw err;
      }
      return { id: data.id, threadId: data.threadId };
    },
  };
}

function fromEnv(env) {
  if (!env.GMAIL_REFRESH_TOKEN) return null;
  return createGmail({
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    from: env.GMAIL_FROM,
    fromName: env.GMAIL_FROM_NAME,
  });
}

module.exports = { createGmail, buildMime, fromEnv, EMAIL };

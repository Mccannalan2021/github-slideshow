// Finds how to apply for a job from its posting text: application email, phone, and method.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Addresses that are never a real application contact.
const IGNORE = /(noreply|no-reply|donotreply|do-not-reply|@indeed\.|@example\.|@sentry|@email\.com$|privacy@|unsubscribe)/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

function extractEmails(text) {
  const found = String(text || '').match(EMAIL) || [];
  return [...new Set(found.map((e) => e.replace(/[.,;:]+$/, '').toLowerCase()))].filter((e) => !IGNORE.test(e));
}

function extractPhones(text) {
  return [...new Set(String(text || '').match(PHONE) || [])].map((p) => p.trim());
}

function detectApplyMethod(text, emails) {
  const t = String(text || '').toLowerCase();
  if (emails.length || /apply (by|via) e-?mail|e-?mail (your )?(resume|cv)|send (your )?(resume|cv)/.test(t)) return 'email';
  if (/apply in person|drop off (your )?resume|in-person/.test(t)) return 'in-person';
  if (/apply (by|via) (phone|telephone)|call us/.test(t)) return 'phone';
  if (/apply (online|on our website|through our website)|careers page/.test(t)) return 'website';
  return '';
}

// Combines explicit fields from a source with whatever the description reveals.
function applyInfo(raw) {
  const text = `${raw.description || ''} ${raw.howToApply || ''}`;
  const emails = [...new Set([...(raw.applyEmails || []), ...(raw.applyEmail ? [raw.applyEmail] : []), ...extractEmails(text)]
    .map((e) => e.toLowerCase()))].filter((e) => !IGNORE.test(e));
  const phones = [...new Set([...(raw.applyPhone ? [raw.applyPhone] : []), ...extractPhones(raw.howToApply || '')])];
  return {
    applyEmail: emails[0] || '',
    applyEmails: emails,
    applyPhone: phones[0] || '',
    applyMethod: raw.applyMethod || detectApplyMethod(text, emails) || (raw.url ? 'website' : ''),
  };
}

module.exports = { extractEmails, extractPhones, detectApplyMethod, applyInfo };

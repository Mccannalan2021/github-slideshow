// Builds ready-to-send messages from the resume and a job:
//   - "apply":    a short note to send with an application
//   - "reply":    an answer to a message from the employer (interview invite, screening question, etc.)
//   - "followup": a polite check-in after applying
const { scoreMatch } = require('./match');

// Default wording; config.json "replies.tones" replaces it when the server runs.
const TONES = {
  professional: { greeting: 'Hello', closing: 'Best regards' },
  friendly: { greeting: 'Hi', closing: 'Thanks so much' },
  brief: { greeting: 'Hi', closing: 'Thanks' },
};

function detectIntent(message) {
  const m = message.toLowerCase();
  if (/interview|schedule|availability|available|call|meet|zoom|phone screen/.test(m)) return 'interview';
  if (/still interested|interested in|confirm/.test(m)) return 'interest';
  if (/salary|pay|rate|compensation|expect/.test(m)) return 'salary';
  if (/start date|when can you start|notice/.test(m)) return 'start';
  if (/unfortunately|not moving forward|other candidates|regret/.test(m)) return 'rejection';
  return 'general';
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || '';
}

function topSkills(resume, job, n = 3) {
  const { matchedSkills } = scoreMatch(resume, job);
  return (matchedSkills.length ? matchedSkills : resume.skills || []).slice(0, n);
}

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function signature(resume, tone) {
  const lines = [`${tone.closing},`, resume.name];
  if (resume.phone) lines.push(resume.phone);
  if (resume.email) lines.push(resume.email);
  return lines.join('\n');
}

function buildReply({ resume, job, type = 'apply', employerMessage = '', tone, availability = '', attached = false, tones = TONES, defaultTone = 'professional' }) {
  const toneName = tones[tone] ? tone : defaultTone;
  const t = tones[toneName];
  const contact = job.contactName ? ` ${firstName(job.contactName)}` : '';
  const greeting = `${t.greeting}${contact},`;
  const skills = joinList(topSkills(resume, job));
  const role = `${job.title} position${job.company ? ` at ${job.company}` : ''}`;
  const recent = (resume.experience || [])[0];
  const brief = toneName === 'brief';

  let body;
  let intent = null;

  if (type === 'apply') {
    body = [
      `I'm excited to apply for the ${role}.`,
      recent && !brief ? `Most recently I worked as ${recent.title}${recent.company ? ` at ${recent.company}` : ''}.` : '',
      skills ? `I bring experience with ${skills}, which line up well with what you're looking for.` : '',
      brief ? '' : `${attached ? 'My resume is attached, and I' : 'I'} would welcome the chance to talk about how I can help your team.`,
    ];
  } else if (type === 'followup') {
    body = [
      `I recently applied for the ${role} and wanted to follow up.`,
      'I am still very interested in the role and happy to share anything else you need.',
    ];
  } else if (type === 'reply') {
    intent = detectIntent(employerMessage);
    const when = availability || 'most weekdays, and I can be flexible around your schedule';
    body = {
      interview: [
        `Thank you for reaching out about the ${role}. I'd be glad to interview.`,
        `I'm available ${when}. Please let me know what time works best for you.`,
      ],
      interest: [
        `Thank you for following up. Yes, I'm still very interested in the ${role}.`,
        skills ? `I'm confident my experience with ${skills} would let me contribute quickly.` : '',
      ],
      salary: [
        `Thank you for asking. For the ${role}, I'm flexible and open to a competitive offer based on the full responsibilities and benefits.`,
        "I'd be happy to discuss the details further.",
      ],
      start: [
        `Thank you for the update on the ${role}.`,
        availability ? `I can start ${availability}.` : 'I can start soon and am happy to work with you on a date that suits the team.',
      ],
      rejection: [
        `Thank you for letting me know, and for considering me for the ${role}.`,
        "I'd appreciate being kept in mind for future openings that fit my background.",
      ],
      general: [
        `Thank you for your message about the ${role}.`,
        "I'm very interested and happy to provide any additional information you need.",
      ],
    }[intent];
  } else {
    throw new Error('type must be one of: apply, reply, followup');
  }

  const message = [greeting, '', body.filter(Boolean).join(' '), '', signature(resume, t)].join('\n');
  const subject = type === 'apply' ? `Application: ${job.title} - ${resume.name}` : `Re: ${job.title}`;
  return { type, tone: toneName, intent, subject, message };
}

module.exports = { buildReply, detectIntent };

// Builds the swipe card for a job. Which fields appear is set by "deck.cardFields" in config.json.
const { buildReply } = require('./quickReply');

function createCardBuilder(config) {
  const fields = config.deck.cardFields;

  return function toCard(job, resume) {
    const all = {
      ...job,
      proximity: job.proximity || null,
      summary: (job.description || '').slice(0, config.deck.summaryLength),
      applyUrl: job.url,
      match: job.match || null,
      reply: null,
    };
    if (resume && fields.includes('reply')) {
      const reply = buildReply({ resume, job, type: 'apply', tones: config.replies.tones, defaultTone: config.replies.defaultTone });
      all.reply = { subject: reply.subject, message: reply.message };
    }
    return Object.fromEntries(fields.map((f) => [f, all[f] ?? null]));
  };
}

module.exports = { createCardBuilder };

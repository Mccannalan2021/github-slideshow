// Send applications from your Gmail (connect it once with `npm run gmail`).
// Your resume file is attached automatically ("email.attachResume" in config.json).
const { buildReply } = require('../quickReply');

module.exports = ({ store, jobs, config, gmail, HttpError, created }) => {
  const today = () => new Date().toISOString().slice(0, 10);
  const sentToday = () => store.listEmails().filter((e) => e.at.startsWith(today())).length;
  // Sends in progress count against the daily limit, so simultaneous requests can't exceed it.
  let sending = 0;

  // A job from the live sources, or from your piles if it has since left them.
  async function findJob(id) {
    const job = await jobs.getJob(id);
    if (job) return job;
    const swipe = store.listSwipes().find((s) => s.jobId === id);
    if (swipe) return { ...swipe.card, url: swipe.card.applyUrl, ...swipe.job, id };
    throw new HttpError(404, `Job ${id} not found`);
  }

  return [
    {
      method: 'GET',
      path: '/email/status',
      handler: async () => {
        const file = store.getResumeFile();
        return {
          connected: Boolean(gmail),
          from: gmail?.from || null,
          sentToday: sentToday(),
          dailyLimit: config.email.dailyLimit,
          resumeFile: file ? file.filename : null,
          ...(gmail ? {} : { howToConnect: 'Run npm run gmail in mccannfam/, then restart the server' }),
        };
      },
    },
    {
      method: 'GET',
      path: '/email/sent',
      handler: async () => [...store.listEmails()].reverse(),
    },
    // Body (all optional except `to` when the posting has no email):
    // { "to": "hr@company.ca", "subject": "...", "message": "...", "tone": "friendly",
    //   "attachResume": true, "preview": true }
    // preview: true returns the email without sending it.
    {
      method: 'POST',
      path: '/jobs/:id/email',
      handler: async ({ params, body }) => {
        const job = await findJob(params.id);
        const to = String(body.to || job.applyEmail || '').trim();
        if (!to) throw new HttpError(400, 'This job has no email address. Send "to" with the address to apply to.');

        const attach = body.attachResume ?? config.email.attachResume;
        const file = attach ? store.getResumeFile() : null;
        let { subject, message } = body;
        if (!subject || !message) {
          const resume = store.getResume();
          if (!resume) throw new HttpError(409, 'Save your resume first (npm run resume or PUT /resume), or send "subject" and "message"');
          const reply = buildReply({ resume, job, type: 'apply', tone: body.tone, attached: Boolean(file), tones: config.replies.tones, defaultTone: config.replies.defaultTone });
          subject = subject || reply.subject;
          message = message || reply.message;
        }

        const email = { to, subject, message, attachment: file ? file.filename : null };
        if (attach && !file) email.warning = 'No resume file saved, so nothing is attached. Add one with npm run resume or PUT /resume/file.';
        if (body.preview) return { preview: true, ...email };

        if (!gmail) throw new HttpError(503, 'Gmail is not connected. Run npm run gmail in mccannfam/, then restart the server.');
        if (sentToday() + sending >= config.email.dailyLimit) {
          throw new HttpError(429, `Daily email limit reached (${config.email.dailyLimit}). Change "email.dailyLimit" in config.json.`);
        }

        sending++;
        let sent;
        try {
          sent = await gmail.send({
            to,
            subject,
            text: message,
            attachments: file ? [{ filename: file.filename, contentType: file.contentType, content: file.content }] : [],
          });
          store.addEmail({ jobId: job.id, to, subject, gmailId: sent.id, attachment: email.attachment });
        } finally {
          sending--;
        }

        // Record the application, and mark it applied in your piles if you swiped it.
        const application = store.addApplication({
          jobId: job.id, title: job.title, company: job.company, url: job.url || '',
          status: 'applied', method: 'email', emailedTo: to, message, notes: '',
        });
        if (store.listSwipes().some((s) => s.jobId === job.id)) {
          store.updateSwipe(job.id, { appliedAt: application.createdAt, applicationId: application.id });
        }
        return created({ sent: true, gmailId: sent.id, ...email, application });
      },
    },
  ];
};

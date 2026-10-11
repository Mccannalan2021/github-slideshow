const { normalizeResume } = require('../resume');

const TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

module.exports = ({ store, requireResume, HttpError }) => [
  { method: 'GET', path: '/resume', handler: async () => requireResume() },
  {
    method: 'PUT',
    path: '/resume',
    handler: async ({ body }) => {
      try {
        return store.saveResume(normalizeResume(body));
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    },
  },
  // Your resume document, attached to application emails. Upload as base64:
  // { "filename": "Jordan Smith Resume.pdf", "contentBase64": "JVBERi0..." }
  {
    method: 'PUT',
    path: '/resume/file',
    maxBody: 15_000_000,
    handler: async ({ body }) => {
      const ext = String(body.filename || '').split('.').pop().toLowerCase();
      if (!TYPES[ext]) throw new HttpError(400, 'filename must end in .pdf, .doc or .docx');
      const content = Buffer.from(String(body.contentBase64 || ''), 'base64');
      if (!content.length) throw new HttpError(400, 'contentBase64 is required');
      if (content.length > 10_000_000) throw new HttpError(413, 'Resume file must be under 10 MB');
      const { path: _path, ...meta } = store.saveResumeFile({ filename: body.filename, contentType: TYPES[ext], content });
      return meta;
    },
  },
  {
    method: 'GET',
    path: '/resume/file',
    handler: async () => {
      const file = store.getResumeFile();
      if (!file) throw new HttpError(404, 'No resume file yet. Upload one with PUT /resume/file or run npm run resume');
      const { content, path: _path, ...meta } = file;
      return meta;
    },
  },
];

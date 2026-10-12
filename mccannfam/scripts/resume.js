#!/usr/bin/env node
// Builds your resume by asking you questions, then saves it for the API (data/resume.json).
// Run it again any time: your current answers show in [brackets]; press Enter to keep them.
//
// Usage: npm run resume
const fs = require('node:fs');
const path = require('node:path');
const { createPrompter, loadEnv } = require('./prompt');
const { createStore } = require('../src/store');
const { normalizeResume, extractSkills } = require('../src/resume');

loadEnv();
const root = path.join(__dirname, '..');
const store = createStore(path.resolve(root, process.env.DATA_DIR || 'data'));
const list = (s) => String(s || '').split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
const TYPES = { '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

// A plain-text version used for matching jobs and as a fallback resume.
function toText(r) {
  const lines = [r.name, [r.email, r.phone, r.location].filter(Boolean).join(' | '), r.headline, '', r.summary, ''];
  if (r.skills.length) lines.push(`Skills: ${r.skills.join(', ')}`, '');
  if (r.experience.length) {
    lines.push('Experience');
    for (const e of r.experience) {
      lines.push(`${e.title}${e.company ? `, ${e.company}` : ''}${e.city ? ` (${e.city})` : ''}  ${e.start || ''}${e.end ? ` - ${e.end}` : ''}`);
      for (const d of e.duties || []) lines.push(`  - ${d}`);
    }
    lines.push('');
  }
  if (r.education.length) {
    lines.push('Education');
    for (const e of r.education) lines.push(`${e.credential}${e.school ? `, ${e.school}` : ''}${e.year ? ` (${e.year})` : ''}`);
    lines.push('');
  }
  if (r.certifications.length) lines.push(`Certifications and licences: ${r.certifications.join(', ')}`);
  if (r.availability) lines.push(`Availability: ${r.availability}`);
  if (r.references) lines.push(`References: ${r.references}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const ask = createPrompter();
  const old = store.getResume() || {};
  console.log('\nResume setup. Press Enter to keep what is in [brackets] or to skip a question.\n');

  console.log('-- About you --');
  const r = {
    name: await ask.question('Full name', old.name),
    email: await ask.question('Email', old.email),
    phone: await ask.question('Phone', old.phone),
    location: await ask.question('City you live in', old.location || 'Red Deer, AB'),
    headline: await ask.question('Job title you want (e.g. Warehouse Associate, Class 1 Driver)', old.headline),
    summary: await ask.question('A few sentences about you and what you are good at', old.summary),
  };

  console.log('\n-- Skills --');
  console.log('  e.g. forklift, customer service, cash handling, Microsoft Office, first aid, bilingual');
  r.skills = list(await ask.question('Skills (comma separated)', (old.skills || []).join(', ')));

  console.log('\n-- Work experience (most recent first) --');
  r.experience = [];
  const oldJobs = old.experience || [];
  if (oldJobs.length && await ask.yesNo(`Keep your ${oldJobs.length} saved job(s)?`, true)) r.experience = oldJobs;
  while (await ask.yesNo(r.experience.length ? 'Add another job?' : 'Add a job?', !r.experience.length)) {
    const job = {
      title: await ask.question('  Job title'),
      company: await ask.question('  Company'),
      city: await ask.question('  City'),
      start: await ask.question('  Start (e.g. May 2023)'),
      end: await ask.question('  End (e.g. Aug 2025, or "present")'),
    };
    job.duties = list(await ask.question('  What you did (separate with ;)')).filter(Boolean);
    if (job.title) r.experience.push(job);
  }

  console.log('\n-- Education --');
  r.education = [];
  const oldEdu = old.education || [];
  if (oldEdu.length && await ask.yesNo(`Keep your ${oldEdu.length} saved education entr${oldEdu.length === 1 ? 'y' : 'ies'}?`, true)) r.education = oldEdu;
  while (await ask.yesNo(r.education.length ? 'Add more education?' : 'Add education (school, diploma, course)?', !r.education.length)) {
    const edu = {
      credential: await ask.question('  Diploma, degree or course (e.g. High School Diploma)'),
      school: await ask.question('  School'),
      year: await ask.question('  Year finished'),
    };
    if (edu.credential) r.education.push(edu);
  }

  console.log('\n-- Extras --');
  r.certifications = list(await ask.question('Certifications and licences (e.g. Class 5, First Aid, WHMIS, H2S)', (old.certifications || []).join(', ')));
  r.availability = await ask.question('Availability (e.g. Full-time, can start right away, weekends OK)', old.availability);
  r.references = await ask.question('References', old.references || 'Available on request');
  r.links = list(await ask.question('Links (LinkedIn, portfolio), comma separated', (old.links || []).join(', ')));

  // Skills mentioned in your answers count too, for job matching.
  r.skills = [...new Set([...r.skills, ...extractSkills(`${r.summary} ${r.experience.map((e) => `${e.title} ${(e.duties || []).join(' ')}`).join(' ')}`)])];

  const resume = normalizeResume({ ...r, text: toText(r) });
  store.saveResume(resume);
  console.log(`\n✔ Saved your resume (${resume.skills.length} skills, ${resume.experience.length} jobs, ${resume.education.length} education).`);

  console.log('\n-- Resume file --');
  const current = store.getResumeFile();
  console.log(current ? `  Attached to emails now: ${current.filename}` : '  A PDF or Word resume to attach when applying by email.');
  const filePath = await ask.question('Path to your resume file (Enter to skip)');
  if (filePath) {
    const full = path.resolve(filePath.replace(/^~(?=\/)/, process.env.HOME || '~').replace(/^["']|["']$/g, ''));
    const ext = path.extname(full).toLowerCase();
    if (!fs.existsSync(full)) console.log(`  Not found: ${full}`);
    else if (!TYPES[ext]) console.log('  Use a .pdf, .doc or .docx file.');
    else {
      store.saveResumeFile({ filename: path.basename(full), contentType: TYPES[ext], content: fs.readFileSync(full) });
      console.log(`  ✔ Saved ${path.basename(full)}`);
    }
  }

  console.log('\nPreview:\n');
  console.log(resume.text.split('\n').map((l) => `  ${l}`).join('\n'));
  console.log('\nRun npm run resume again any time to change it.');
  ask.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

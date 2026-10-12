// Scores how well a job fits the resume, based on skill and title overlap.
function scoreMatch(resume, job) {
  const haystack = `${job.title} ${job.description || ''}`.toLowerCase();
  const skills = resume.skills || [];
  const matched = skills.filter((s) => haystack.includes(s.toLowerCase()));
  const missing = (job.skills || []).filter(
    (s) => !skills.some((r) => r.toLowerCase() === s.toLowerCase()),
  );

  const titles = [resume.headline, ...(resume.experience || []).map((e) => e.title)]
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  const titleWords = new Set(titles.flatMap((t) => t.split(/\W+/)).filter((w) => w.length > 2));
  const jobTitleWords = job.title.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const titleHit = jobTitleWords.some((w) => titleWords.has(w));

  const skillScore = skills.length ? matched.length / Math.min(skills.length, 8) : 0;
  const score = Math.round(Math.min(1, skillScore * 0.8 + (titleHit ? 0.2 : 0)) * 100);

  return { jobId: job.id, score, matchedSkills: matched, missingSkills: missing, titleMatch: titleHit };
}

module.exports = { scoreMatch };

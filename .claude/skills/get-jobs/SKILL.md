---
name: get-jobs
description: Pull new job listings from the last 24 hours (Red Deer first, then the rest of Alberta) from every job site Claude can reach, add them to the Alberta Jobs API's job files in job-api/, and commit. Use when the user says "get jobs", "pull jobs", "refresh jobs", "update the jobs", or asks for new listings for Red Deer or Alberta.
---

# Get jobs

Adds the last 24 hours of postings to the job files the API serves (`job-api/sources/*.json`).
Jobs already saved stay; jobs older than 30 days drop off. Everything it needs is in the repo:

- `job-api/pull-plan.json`: every search to run, per site. Edit it to add towns, keywords or slices.
- `job-api/raw/<site>/`: where raw results are saved (git-ignored).
- `npm run import` (in `job-api/`): turns the raw results into `sources/*.json` and prints a summary.

## Steps

1. **Pick the window** from `pull-plan.json` → `window`. Use `daily` (last 24 hours) unless the user
   asks for the past week or `job-api/sources/` has no job files; then use `week`.
   Clear the raw folders from any previous run (the saved job files in `sources/` stay):
   `rm -rf job-api/raw/indeed job-api/raw/ziprecruiter && mkdir -p job-api/raw/indeed job-api/raw/ziprecruiter`

2. **Load the job-site tools** with ToolSearch: `select:mcp__ZipRecruiter__search_jobs,mcp__Indeed__search_jobs`.
   Use only these official connectors. Never scrape job sites directly.

3. **ZipRecruiter** (most complete for the past week; do it first). Read `pull-plan.json` → `ziprecruiter`.
   For every slice, call `mcp__ZipRecruiter__search_jobs` with `base`, the window's
   `max_posted_minutes_ago`, and the slice's filters, once for each value in `offsets`. Slices:
   - `employment_types`: each list as `employment_types`
   - `seniority_classes`: each list as `seniority_classes`
   - `type_x_seniority`: every combination of the two lists
   - `salary_bands`: each `[min, max]` as `salary_min` / `salary_max`
   - `location_types`: each list as `location_types`
   - `job_roles`: each as `job_role`
   - `nearby_towns`: each town as `location` with the given `radius_miles`

   Never pass `conversation_id`. If offset 0 returns 0 results, skip that slice's other offsets.
   Save each call's complete raw JSON, unedited, to `job-api/raw/ziprecruiter/<slice>__o<offset>.json`
   (letters, digits and dashes in the slice name, e.g. `role-delivery-driver__o5.json`).
   For a big plan, hand the calls to 2–3 background agents, giving each a part of the slice list.

4. **Indeed.** Read `pull-plan.json` → `indeed`. For every search group, call `mcp__Indeed__search_jobs`
   for each location × keyword (and × `job_types` as `job_type`, when given) with `country_code`.
   Save each call's raw `result` text, unedited, to
   `job-api/raw/indeed/<Location>__<keyword>.md` (spaces, commas and periods → `_`, e.g.
   `Red_Deer_AB__class_1_driver.md`; with a job type: `Red_Deer_AB__jobs_parttime.md`).
   Indeed's account quota is small: run at most 3 calls at a time. If "Rate limit exceeded" keeps
   coming back after a few minutes of waiting, stop and report how far you got. Do the Red Deer groups first.

5. **Import** with the window's command, from `job-api/`:
   - daily: `npm run import` (adds jobs posted today or yesterday to the existing files)
   - week: `npm run import -- --full` (rebuilds the files from everything just pulled)

   It prints how many jobs were new and totals for Alberta and the Red Deer region.

6. **Check**: `npm test` must pass.

7. **Commit and push** the updated `job-api/sources/*.json` with a message such as
   "Add N new jobs (last 24 hours): M in Red Deer region".

8. **Report** to the user: how many new jobs were added, new ones in the Red Deer region, totals from
   the import summary, and any searches that failed or were skipped (e.g. Indeed rate limits).

## Notes

- The API can show only recent jobs with `?postedWithin=1` (or `7`).
- ZipRecruiter's smallest window is 1440 minutes (24 hours).
- Duplicates across sites and searches are removed by the API (same title, company and city).
- If a connector is missing in the session, say which one and continue with the others.

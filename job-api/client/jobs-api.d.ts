// Types for client/jobs-api.js. Use with TypeScript web apps.

export type JobType = 'full-time' | 'part-time' | 'contract' | 'temporary' | 'seasonal' | 'casual' | '';
export type Proximity = 'city' | 'region' | 'alberta' | null;
export type SortOrder = 'relevance' | 'date' | 'salary' | 'match';
export type ApplyMethod = 'email' | 'in-person' | 'phone' | 'website' | '';

export interface JobFilters {
  q?: string;
  city?: string;
  region?: string;
  near?: string;
  type?: JobType;
  remote?: boolean;
  hasEmail?: boolean;
  minSalary?: number;
  postedWithin?: number;
  sources?: string[];
  sort?: SortOrder;
  page?: number;
  limit?: number | 'all';
  match?: boolean;
}

export interface Match {
  jobId: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  titleMatch: boolean;
}

export interface Job {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  company: string;
  location: string;
  city: string;
  region: string;
  remote: boolean;
  type: JobType;
  category: string;
  salary: string;
  salaryMin: number | null;
  salaryMax: number | null;
  postedAt: string;
  description: string;
  url: string;
  applyEmail: string;
  applyEmails: string[];
  applyPhone: string;
  applyMethod: ApplyMethod;
  skills: string[];
  alsoListedOn: { id: string; source: string; url: string }[];
  proximity?: Proximity;
  match?: Match;
}

export interface Facet { value: string; count: number }

export interface SourceStatus {
  name: string;
  ok: boolean;
  fetched?: number;
  totalAvailable?: number;
  cached?: boolean;
  error?: string;
}

export interface SearchResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  filters: Record<string, unknown>;
  removed: { outsideAlberta: number; duplicates: number };
  sources: SourceStatus[];
  facets: {
    cities: Facet[];
    regions: Facet[];
    types: Facet[];
    categories: Facet[];
    companies: Facet[];
    sources: Facet[];
    remote: number;
    withApplyEmail: number;
    applyMethods: Facet[];
    salary: { jobsWithSalary: number; medianMin: number | null; medianMax: number | null };
  };
  jobs: Job[];
}

export interface Reply { subject: string; message: string }

/** Fields present depend on "deck.cardFields" in config.json. */
export interface Card {
  id: string;
  title: string;
  company?: string;
  location?: string;
  city?: string;
  proximity?: Proximity;
  type?: JobType;
  salary?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  remote?: boolean;
  postedAt?: string;
  summary?: string;
  source?: string;
  applyUrl?: string;
  match?: Match | null;
  reply?: Reply | null;
  [field: string]: unknown;
}

export interface Deck {
  remaining: number;
  hasResume: boolean;
  sources: SourceStatus[];
  cards: Card[];
}

export interface Swipe {
  jobId: string;
  direction: string;
  pile: string;
  at: string;
  card: Card;
  appliedAt?: string;
  applicationId?: string;
}

export type PileJob = Card & { jobId: string; direction: string; pile: string; at: string; appliedAt?: string };

export interface Settings {
  homeCity: string | null;
  swipes: { direction: string; pile: string }[];
  cardFields: string[];
  deckSize: number;
  tones: string[];
  applicationStatuses: string[];
}

export interface Resume {
  name: string;
  email: string;
  phone: string;
  headline: string;
  summary: string;
  location: string;
  skills: string[];
  experience: { title: string; company?: string; city?: string; start?: string; end?: string; duties?: string[] }[];
  education: { credential: string; school?: string; year?: string }[];
  certifications: string[];
  availability: string;
  references: string;
  links: string[];
  text: string;
  updatedAt?: string;
}

export interface Application {
  id: string;
  jobId: string;
  title: string;
  company: string;
  url: string;
  status: string;
  message: string;
  notes: string;
  pile?: string;
  method?: 'email';
  emailedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailResult {
  to: string;
  subject: string;
  message: string;
  attachment: string | null;
  warning?: string;
  preview?: true;
  sent?: true;
  gmailId?: string;
  application?: Application;
}

export declare class JobsApiError extends Error {
  status: number;
  body: unknown;
}

export interface JobsApi {
  health(): Promise<{ ok: boolean; sources: string[]; homeCity: string | null }>;
  settings(): Promise<Settings>;
  sources(): Promise<{ name: string; kind: 'file' | 'live'; jobs?: number; fetchedAt?: string }[]>;
  cities(): Promise<{ regions: { name: string; cities: string[] }[]; jobTypes: JobType[]; sorts: SortOrder[] }>;

  searchJobs(filters?: JobFilters): Promise<SearchResult>;
  getJob(jobId: string): Promise<Job>;
  matchJob(jobId: string): Promise<Match>;
  quickReply(jobId: string, options?: { type?: 'apply' | 'reply' | 'followup'; tone?: string; employerMessage?: string; availability?: string }):
    Promise<Reply & { jobId: string; applyUrl: string; type: string; tone: string; intent: string | null }>;
  insights(filters?: JobFilters): Promise<Omit<SearchResult['facets'], never> & { total: number }>;
  downloadCsv(filters?: JobFilters): Promise<Blob>;

  deck(filters?: JobFilters): Promise<Deck>;
  swipe(jobId: string, direction: string): Promise<Swipe>;
  undoSwipe(): Promise<{ undone: { jobId: string; direction: string; pile: string } }>;
  swipeStats(): Promise<Record<string, number>>;
  piles(): Promise<Record<string, number>>;
  pile(name: string, options?: { applied?: boolean }): Promise<PileJob[]>;
  moveToPile(jobId: string, direction: string): Promise<Swipe>;
  removeFromPile(jobId: string): Promise<{ removed: string }>;
  applyFromPile(jobId: string, options?: { message?: string; notes?: string }): Promise<{ applyUrl: string; message: string; application: Application }>;

  getResume(): Promise<Resume>;
  saveResume(resume: Partial<Resume> & ({ name: string } | { text: string })): Promise<Resume>;
  uploadResumeFile(file: Blob | Uint8Array, filename?: string): Promise<{ filename: string; contentType: string; size: number; updatedAt: string }>;
  getResumeFile(): Promise<{ filename: string; contentType: string; size: number; updatedAt: string }>;

  emailStatus(): Promise<{ connected: boolean; from: string | null; sentToday: number; dailyLimit: number; resumeFile: string | null; howToConnect?: string }>;
  sentEmails(): Promise<{ jobId: string; to: string; subject: string; gmailId: string; attachment: string | null; at: string }[]>;
  emailJob(jobId: string, options?: { to?: string; subject?: string; message?: string; tone?: string; attachResume?: boolean; preview?: boolean }): Promise<EmailResult>;
  previewEmail(jobId: string, options?: { to?: string; subject?: string; message?: string; tone?: string; attachResume?: boolean }): Promise<EmailResult>;

  applications(status?: string): Promise<Application[]>;
  addApplication(application: { jobId: string; status?: string; message?: string; notes?: string }): Promise<Application>;
  updateApplication(id: string, changes: { status?: string; message?: string; notes?: string }): Promise<Application>;

  savedSearches(): Promise<{ id: string; name: string; filters: JobFilters; createdAt: string; lastRunAt: string | null }[]>;
  saveSearch(name: string, filters: JobFilters): Promise<{ id: string; name: string; filters: JobFilters }>;
  runSavedSearch(id: string, options?: { onlyNew?: boolean; page?: number; limit?: number }): Promise<SearchResult & { newCount: number; jobs: (Job & { isNew: boolean })[] }>;
  deleteSavedSearch(id: string): Promise<{ deleted: true }>;

  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export declare function createJobsApi(options: { baseUrl: string; apiKey?: string; fetch?: typeof fetch }): JobsApi;

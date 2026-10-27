import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';

export interface GitHubRepositoryItem {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  htmlUrl: string;
  updatedAt: string;
}

export interface GitHubSearchResponse {
  items: GitHubRepositoryItem[];
  totalCount: number;
  page: number;
  perPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface RawGitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner?: { login?: string };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  updated_at: string;
}

interface RawGitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: RawGitHubRepo[];
}

export async function searchGitHubRepositories(params: {
  q: string;
  language?: string;
  minStars?: number;
  page: number;
  perPage: number;
}): Promise<GitHubSearchResponse> {
  // GitHub search API limits results to the first 1000 matches
  const maxAccessibleResults = 1000;
  const maxPage = Math.max(1, Math.floor(maxAccessibleResults / params.perPage));
  const safePage = Math.min(params.page, maxPage);

  const qualifiers: string[] = [params.q.trim()];
  if (params.language && params.language.trim().length > 0) {
    qualifiers.push(`language:${params.language.trim()}`);
  }
  if (params.minStars !== undefined && params.minStars > 0) {
    qualifiers.push(`stars:>=${params.minStars}`);
  }

  const combinedQuery = qualifiers.join(' ');
  const url = new URL('/search/repositories', env.GITHUB_API_BASE_URL);
  url.searchParams.set('q', combinedQuery);
  url.searchParams.set('page', String(safePage));
  url.searchParams.set('per_page', String(params.perPage));
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Unpause-MVP-Course-Project',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim().length > 0) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN.trim()}`;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw Errors.githubUpstream(
      'Unable to reach GitHub API. Please check your network connection and retry.'
    );
  }

  if (!response.ok) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const rateLimitReset = response.headers.get('x-ratelimit-reset');
    let bodyMessage = '';
    try {
      const errBody = (await response.json()) as { message?: string };
      bodyMessage = errBody?.message ?? '';
    } catch {
      // ignore body parse failure
    }

    if (
      response.status === 429 ||
      (response.status === 403 &&
        (rateLimitRemaining === '0' ||
          bodyMessage.toLowerCase().includes('rate limit')))
    ) {
      const resetAtIso =
        rateLimitReset && !Number.isNaN(Number(rateLimitReset))
          ? new Date(Number(rateLimitReset) * 1000).toISOString()
          : undefined;
      throw Errors.githubRateLimit(
        'GitHub API rate limit reached. Please wait a moment and try again.',
        resetAtIso ? { resetAt: resetAtIso } : undefined
      );
    }

    throw Errors.githubUpstream(
      bodyMessage
        ? `GitHub API returned an error (${response.status}): ${bodyMessage}`
        : `GitHub API request failed with status ${response.status}.`
    );
  }

  let data: RawGitHubSearchResponse;
  try {
    data = (await response.json()) as RawGitHubSearchResponse;
  } catch {
    throw Errors.githubUpstream('Invalid response received from GitHub API.');
  }

  if (!data || !Array.isArray(data.items)) {
    throw Errors.githubUpstream('Unexpected payload structure from GitHub API.');
  }

  const totalCount = typeof data.total_count === 'number' ? data.total_count : 0;
  const effectiveMaxTotal = Math.min(totalCount, maxAccessibleResults);
  const hasNextPage = safePage * params.perPage < effectiveMaxTotal;
  const hasPreviousPage = safePage > 1;

  const items: GitHubRepositoryItem[] = data.items.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login ?? '',
    description: repo.description ?? '',
    language: repo.language ?? null,
    stargazersCount: repo.stargazers_count ?? 0,
    forksCount: repo.forks_count ?? 0,
    htmlUrl: repo.html_url,
    updatedAt: repo.updated_at,
  }));

  return {
    items,
    totalCount,
    page: safePage,
    perPage: params.perPage,
    hasNextPage,
    hasPreviousPage,
  };
}

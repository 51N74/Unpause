export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_ORIGIN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PROJECT_ARCHIVED'
  | 'SCOPE_VERSION_IMMUTABLE'
  | 'GITHUB_RATE_LIMIT'
  | 'GITHUB_UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  validation: (message: string, details?: unknown) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'Access denied') =>
    new AppError(403, 'FORBIDDEN', message),
  invalidOrigin: (message = 'Origin is not permitted for state-changing requests') =>
    new AppError(403, 'INVALID_ORIGIN', message),
  notFound: (message = 'Resource not found') =>
    new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string, details?: unknown) =>
    new AppError(409, 'CONFLICT', message, details),
  projectArchived: (
    message = 'Archived projects are read-only. Restore the project to make changes.'
  ) => new AppError(409, 'PROJECT_ARCHIVED', message),
  scopeVersionImmutable: (
    message = 'Scope versions are immutable and cannot be updated or deleted.'
  ) => new AppError(405, 'SCOPE_VERSION_IMMUTABLE', message),
  githubRateLimit: (
    message = 'GitHub API rate limit exceeded. Please wait and retry.',
    details?: unknown
  ) => new AppError(429, 'GITHUB_RATE_LIMIT', message, details),
  githubUpstream: (
    message = 'Failed to fetch repositories from GitHub API.',
    details?: unknown
  ) => new AppError(502, 'GITHUB_UPSTREAM_ERROR', message, details),
};

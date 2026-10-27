export type ProjectStatus = 'Active' | 'Archived';
export type IssueStatus = 'Open' | 'In Progress' | 'Closed';
export type IssuePriority = 'High' | 'Medium' | 'Low';
export type ScopeImpact = 'None' | 'Expands' | 'Narrows' | 'Changes direction';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  problem: string;
  targetUsers: string;
  goal: string;
  inScope: string;
  outOfScope: string;
  reasonForChange: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  currentScopeVersion: number;
  currentScope: ScopeVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRecord {
  id: string;
  projectId: string;
  scopeVersionId: string;
  scopeVersion?: {
    id: string;
    versionNumber: number;
    reasonForChange: string;
    createdAt: string;
  };
  issueId: string | null;
  issue: {
    id: string;
    title: string;
    status: IssueStatus;
  } | null;
  problem: string;
  decision: string;
  rationale: string;
  alternativesConsidered: string;
  outcome: string;
  scopeImpact: ScopeImpact;
  isPinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeContextResponse {
  project: Project;
  currentScope: ScopeVersion;
  pinnedDecisions: DecisionRecord[];
  recentDecisions: DecisionRecord[];
  outstandingIssues: Issue[];
}

export interface TimelineScopeVersion extends ScopeVersion {
  isCurrent: boolean;
  decisions: DecisionRecord[];
}

export interface ScopeTimelineResponse {
  project: Project;
  versions: TimelineScopeVersion[];
}

export interface PaginatedIssuesResponse {
  items: Issue[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

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

export interface ApiErrorDetail {
  path?: string;
  message: string;
}

export interface ParsedApiError {
  id?: string;
  code: string;
  message: string;
  details?: unknown;
  status?: number;
}

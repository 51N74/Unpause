import { apiClient } from './client';
import type {
  DecisionRecord,
  GitHubSearchResponse,
  Issue,
  IssuePriority,
  IssueStatus,
  PaginatedIssuesResponse,
  Project,
  ProjectStatus,
  ResumeContextResponse,
  ScopeImpact,
  ScopeTimelineResponse,
  ScopeVersion,
  User,
} from '../types/api';

export const authApi = {
  async register(payload: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<{ user: User }> {
    const { data } = await apiClient.post<{ user: User }>('/auth/register', payload);
    return data;
  },

  async login(payload: {
    email: string;
    password: string;
  }): Promise<{ user: User }> {
    const { data } = await apiClient.post<{ user: User }>('/auth/login', payload);
    return data;
  },

  async logout(): Promise<{ success: boolean }> {
    const { data } = await apiClient.post<{ success: boolean }>('/auth/logout');
    return data;
  },

  async me(): Promise<{ user: User }> {
    const { data } = await apiClient.get<{ user: User }>('/auth/me');
    return data;
  },

  async updateDisplayName(displayName: string): Promise<{ user: User }> {
    const { data } = await apiClient.patch<{ user: User }>('/users/me', {
      displayName,
    });
    return data;
  },
};

export const projectsApi = {
  async list(params?: {
    search?: string;
    status?: ProjectStatus | 'All';
  }): Promise<{ projects: Project[] }> {
    const { data } = await apiClient.get<{ projects: Project[] }>('/projects', {
      params,
    });
    return data;
  },

  async create(payload: {
    name: string;
    description?: string;
    initialScope: {
      problem: string;
      targetUsers: string;
      goal: string;
      inScope: string;
      outOfScope: string;
    };
  }): Promise<{ project: Project; initialScopeVersion: ScopeVersion }> {
    const { data } = await apiClient.post<{
      project: Project;
      initialScopeVersion: ScopeVersion;
    }>('/projects', payload);
    return data;
  },

  async getById(projectId: string): Promise<{ project: Project }> {
    const { data } = await apiClient.get<{ project: Project }>(
      `/projects/${projectId}`
    );
    return data;
  },

  async update(
    projectId: string,
    payload: { name?: string; description?: string }
  ): Promise<{ project: Project }> {
    const { data } = await apiClient.patch<{ project: Project }>(
      `/projects/${projectId}`,
      payload
    );
    return data;
  },

  async archive(projectId: string): Promise<{ project: Project }> {
    const { data } = await apiClient.post<{ project: Project }>(
      `/projects/${projectId}/archive`
    );
    return data;
  },

  async restore(projectId: string): Promise<{ project: Project }> {
    const { data } = await apiClient.post<{ project: Project }>(
      `/projects/${projectId}/restore`
    );
    return data;
  },

  async getResumeContext(projectId: string): Promise<ResumeContextResponse> {
    const { data } = await apiClient.get<ResumeContextResponse>(
      `/projects/${projectId}/resume-context`
    );
    return data;
  },

  async getTimeline(projectId: string): Promise<ScopeTimelineResponse> {
    const { data } = await apiClient.get<ScopeTimelineResponse>(
      `/projects/${projectId}/timeline`
    );
    return data;
  },
};

export const scopeVersionsApi = {
  async list(projectId: string): Promise<{
    currentScope: ScopeVersion | null;
    versions: ScopeVersion[];
  }> {
    const { data } = await apiClient.get<{
      currentScope: ScopeVersion | null;
      versions: ScopeVersion[];
    }>(`/projects/${projectId}/scope-versions`);
    return data;
  },

  async create(
    projectId: string,
    payload: {
      problem: string;
      targetUsers: string;
      goal: string;
      inScope: string;
      outOfScope: string;
      reasonForChange: string;
    }
  ): Promise<{ scopeVersion: ScopeVersion }> {
    const { data } = await apiClient.post<{ scopeVersion: ScopeVersion }>(
      `/projects/${projectId}/scope-versions`,
      payload
    );
    return data;
  },
};

export const issuesApi = {
  async list(
    projectId: string,
    params?: {
      status?: IssueStatus;
      priority?: IssuePriority;
      search?: string;
      page?: number;
      pageSize?: number;
    }
  ): Promise<PaginatedIssuesResponse> {
    const { data } = await apiClient.get<PaginatedIssuesResponse>(
      `/projects/${projectId}/issues`,
      { params }
    );
    return data;
  },

  async create(
    projectId: string,
    payload: {
      title: string;
      description?: string;
      status?: IssueStatus;
      priority?: IssuePriority;
      nextAction: string;
    }
  ): Promise<{ issue: Issue }> {
    const { data } = await apiClient.post<{ issue: Issue }>(
      `/projects/${projectId}/issues`,
      payload
    );
    return data;
  },

  async getById(
    projectId: string,
    issueId: string
  ): Promise<{ issue: Issue & { decisionRecords?: DecisionRecord[] } }> {
    const { data } = await apiClient.get<{
      issue: Issue & { decisionRecords?: DecisionRecord[] };
    }>(`/projects/${projectId}/issues/${issueId}`);
    return data;
  },

  async update(
    projectId: string,
    issueId: string,
    payload: {
      title?: string;
      description?: string;
      status?: IssueStatus;
      priority?: IssuePriority;
      nextAction?: string;
    }
  ): Promise<{ issue: Issue }> {
    const { data } = await apiClient.patch<{ issue: Issue }>(
      `/projects/${projectId}/issues/${issueId}`,
      payload
    );
    return data;
  },

  async remove(
    projectId: string,
    issueId: string
  ): Promise<{ deleted: boolean }> {
    const { data } = await apiClient.delete<{ deleted: boolean }>(
      `/projects/${projectId}/issues/${issueId}`
    );
    return data;
  },
};

export const decisionsApi = {
  async list(
    projectId: string,
    params?: {
      search?: string;
      scopeImpact?: ScopeImpact;
      scopeVersionId?: string;
      pinnedOnly?: boolean;
    }
  ): Promise<{ decisions: DecisionRecord[] }> {
    const { data } = await apiClient.get<{ decisions: DecisionRecord[] }>(
      `/projects/${projectId}/decisions`,
      {
        params: {
          ...params,
          pinnedOnly:
            params?.pinnedOnly !== undefined
              ? String(params.pinnedOnly)
              : undefined,
        },
      }
    );
    return data;
  },

  async create(
    projectId: string,
    payload: {
      problem: string;
      decision: string;
      rationale: string;
      alternativesConsidered?: string;
      outcome?: string;
      scopeImpact: ScopeImpact;
      issueId?: string | null;
    }
  ): Promise<{ decision: DecisionRecord }> {
    const { data } = await apiClient.post<{ decision: DecisionRecord }>(
      `/projects/${projectId}/decisions`,
      payload
    );
    return data;
  },

  async getById(
    projectId: string,
    decisionId: string
  ): Promise<{ decision: DecisionRecord }> {
    const { data } = await apiClient.get<{ decision: DecisionRecord }>(
      `/projects/${projectId}/decisions/${decisionId}`
    );
    return data;
  },

  async update(
    projectId: string,
    decisionId: string,
    payload: {
      problem?: string;
      decision?: string;
      rationale?: string;
      alternativesConsidered?: string;
      outcome?: string;
      scopeImpact?: ScopeImpact;
      issueId?: string | null;
    }
  ): Promise<{ decision: DecisionRecord }> {
    const { data } = await apiClient.patch<{ decision: DecisionRecord }>(
      `/projects/${projectId}/decisions/${decisionId}`,
      payload
    );
    return data;
  },

  async setPinned(
    projectId: string,
    decisionId: string,
    isPinned: boolean
  ): Promise<{ decision: DecisionRecord }> {
    const { data } = await apiClient.patch<{ decision: DecisionRecord }>(
      `/projects/${projectId}/decisions/${decisionId}/pin`,
      { isPinned }
    );
    return data;
  },

  async remove(
    projectId: string,
    decisionId: string
  ): Promise<{ deleted: boolean }> {
    const { data } = await apiClient.delete<{ deleted: boolean }>(
      `/projects/${projectId}/decisions/${decisionId}`
    );
    return data;
  },
};

export const githubApi = {
  async searchRepositories(params: {
    q: string;
    language?: string;
    minStars?: number;
    page?: number;
    perPage?: number;
  }): Promise<GitHubSearchResponse> {
    const { data } = await apiClient.get<GitHubSearchResponse>(
      '/github/repositories',
      { params }
    );
    return data;
  },
};

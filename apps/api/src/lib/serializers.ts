import type {
  DecisionRecord,
  Issue,
  IssuePriority,
  IssueStatus,
  Project,
  ProjectStatus,
  ScopeImpact,
  ScopeVersion,
  User,
} from '@prisma/client';

export type ApiIssueStatus = 'Open' | 'In Progress' | 'Closed';
export type ApiIssuePriority = 'High' | 'Medium' | 'Low';
export type ApiProjectStatus = 'Active' | 'Archived';
export type ApiScopeImpact = 'None' | 'Expands' | 'Narrows' | 'Changes direction';

export function toPrismaIssueStatus(status: ApiIssueStatus): IssueStatus {
  switch (status) {
    case 'Open':
      return 'Open';
    case 'In Progress':
      return 'InProgress';
    case 'Closed':
      return 'Closed';
  }
}

export function fromPrismaIssueStatus(status: IssueStatus): ApiIssueStatus {
  switch (status) {
    case 'Open':
      return 'Open';
    case 'InProgress':
      return 'In Progress';
    case 'Closed':
      return 'Closed';
  }
}

export function toPrismaScopeImpact(impact: ApiScopeImpact): ScopeImpact {
  switch (impact) {
    case 'None':
      return 'None';
    case 'Expands':
      return 'Expands';
    case 'Narrows':
      return 'Narrows';
    case 'Changes direction':
      return 'ChangesDirection';
  }
}

export function fromPrismaScopeImpact(impact: ScopeImpact): ApiScopeImpact {
  switch (impact) {
    case 'None':
      return 'None';
    case 'Expands':
      return 'Expands';
    case 'Narrows':
      return 'Narrows';
    case 'ChangesDirection':
      return 'Changes direction';
  }
}

export function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function serializeScopeVersion(sv: ScopeVersion) {
  return {
    id: sv.id,
    projectId: sv.projectId,
    versionNumber: sv.versionNumber,
    problem: sv.problem,
    targetUsers: sv.targetUsers,
    goal: sv.goal,
    inScope: sv.inScope,
    outOfScope: sv.outOfScope,
    reasonForChange: sv.reasonForChange,
    createdAt: sv.createdAt.toISOString(),
  };
}

export function serializeProject(
  project: Project & {
    scopeVersions?: ScopeVersion[];
    _count?: {
      issues?: number;
      decisionRecords?: number;
      scopeVersions?: number;
    };
  }
) {
  const latestScope =
    project.scopeVersions && project.scopeVersions.length > 0
      ? project.scopeVersions[0]
      : null;

  return {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    status: project.status as ApiProjectStatus,
    currentScopeVersion: latestScope ? latestScope.versionNumber : 1,
    currentScope: latestScope ? serializeScopeVersion(latestScope) : null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function serializeIssue(issue: Issue) {
  return {
    id: issue.id,
    projectId: issue.projectId,
    title: issue.title,
    description: issue.description ?? '',
    status: fromPrismaIssueStatus(issue.status),
    priority: issue.priority as ApiIssuePriority,
    nextAction: issue.nextAction,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

export function serializeDecision(
  decision: DecisionRecord & {
    scopeVersion?: Pick<ScopeVersion, 'id' | 'versionNumber' | 'reasonForChange' | 'createdAt'> | null;
    issue?: Pick<Issue, 'id' | 'title' | 'status'> | null;
  }
) {
  return {
    id: decision.id,
    projectId: decision.projectId,
    scopeVersionId: decision.scopeVersionId,
    scopeVersion: decision.scopeVersion
      ? {
          id: decision.scopeVersion.id,
          versionNumber: decision.scopeVersion.versionNumber,
          reasonForChange: decision.scopeVersion.reasonForChange,
          createdAt: decision.scopeVersion.createdAt.toISOString(),
        }
      : undefined,
    issueId: decision.issueId ?? null,
    issue: decision.issue
      ? {
          id: decision.issue.id,
          title: decision.issue.title,
          status: fromPrismaIssueStatus(decision.issue.status),
        }
      : null,
    problem: decision.problem,
    decision: decision.decision,
    rationale: decision.rationale,
    alternativesConsidered: decision.alternativesConsidered ?? '',
    outcome: decision.outcome ?? '',
    scopeImpact: fromPrismaScopeImpact(decision.scopeImpact),
    isPinned: decision.isPinned,
    pinnedAt: decision.pinnedAt ? decision.pinnedAt.toISOString() : null,
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}

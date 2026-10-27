import type { IssuePriority, Prisma } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import {
  serializeDecision,
  serializeIssue,
  serializeProject,
  serializeScopeVersion,
} from '../lib/serializers.js';

export const INITIAL_SCOPE_REASON = 'Initial scope';

export async function getOwnedProjectOrThrow(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    include: {
      scopeVersions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  if (!project) {
    throw Errors.notFound('Project not found');
  }

  return project;
}

export async function getActiveOwnedProjectOrThrow(
  userId: string,
  projectId: string
) {
  const project = await getOwnedProjectOrThrow(userId, projectId);
  if (project.status === 'Archived') {
    throw Errors.projectArchived();
  }
  return project;
}

export async function listUserProjects(
  userId: string,
  filters: { search?: string; status?: 'Active' | 'Archived' | 'All' }
) {
  const where: Prisma.ProjectWhereInput = {
    userId,
  };

  if (filters.status && filters.status !== 'All') {
    where.status = filters.status;
  }

  if (filters.search && filters.search.trim().length > 0) {
    where.name = {
      contains: filters.search.trim(),
      mode: 'insensitive',
    };
  }

  const projects = await prisma.project.findMany({
    where,
    include: {
      scopeVersions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return projects.map(serializeProject);
}

export async function createProjectWithInitialScope(
  userId: string,
  input: {
    name: string;
    description?: string;
    initialScope: {
      problem: string;
      targetUsers: string;
      goal: string;
      inScope: string;
      outOfScope: string;
    };
  }
) {
  const result = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        userId,
        name: input.name,
        description: input.description ?? '',
        status: 'Active',
      },
    });

    const scopeVersion = await tx.scopeVersion.create({
      data: {
        projectId: project.id,
        versionNumber: 1,
        problem: input.initialScope.problem,
        targetUsers: input.initialScope.targetUsers,
        goal: input.initialScope.goal,
        inScope: input.initialScope.inScope,
        outOfScope: input.initialScope.outOfScope,
        reasonForChange: 'Initial scope',
      },
    });

    return {
      project: {
        ...project,
        scopeVersions: [scopeVersion],
      },
      initialScopeVersion: scopeVersion,
    };
  });

  return {
    project: serializeProject(result.project),
    initialScopeVersion: serializeScopeVersion(result.initialScopeVersion),
  };
}

export async function getProjectDetail(userId: string, projectId: string) {
  const project = await getOwnedProjectOrThrow(userId, projectId);
  return serializeProject(project);
}

export async function updateProjectDetails(
  userId: string,
  projectId: string,
  input: { name?: string; description?: string }
) {
  await getActiveOwnedProjectOrThrow(userId, projectId);

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    include: {
      scopeVersions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  return serializeProject(updated);
}

export async function archiveProject(userId: string, projectId: string) {
  await getOwnedProjectOrThrow(userId, projectId);

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status: 'Archived' },
    include: {
      scopeVersions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  return serializeProject(updated);
}

export async function restoreProject(userId: string, projectId: string) {
  await getOwnedProjectOrThrow(userId, projectId);

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status: 'Active' },
    include: {
      scopeVersions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  return serializeProject(updated);
}

const PRIORITY_RANK: Record<IssuePriority, number> = {
  High: 1,
  Medium: 2,
  Low: 3,
};

export async function getProjectResumeContext(userId: string, projectId: string) {
  const project = await getOwnedProjectOrThrow(userId, projectId);
  const currentScope = project.scopeVersions[0];
  if (!currentScope) {
    throw Errors.notFound('Project has no scope version');
  }

  const [pinnedDecisions, recentDecisionsUnderCurrentScope, openAndInProgressIssues] =
    await Promise.all([
      prisma.decisionRecord.findMany({
        where: {
          projectId,
          isPinned: true,
        },
        include: {
          scopeVersion: {
            select: {
              id: true,
              versionNumber: true,
              reasonForChange: true,
              createdAt: true,
            },
          },
          issue: {
            select: {
              id: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
        take: 3,
      }),
      prisma.decisionRecord.findMany({
        where: {
          projectId,
          scopeVersionId: currentScope.id,
        },
        include: {
          scopeVersion: {
            select: {
              id: true,
              versionNumber: true,
              reasonForChange: true,
              createdAt: true,
            },
          },
          issue: {
            select: {
              id: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.issue.findMany({
        where: {
          projectId,
          status: { in: ['Open', 'InProgress'] },
        },
      }),
    ]);

  // Sort outstanding issues by priority (High -> Medium -> Low), then by most recent modification
  const sortedOutstandingIssues = openAndInProgressIssues
    .sort((a, b) => {
      const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (rankDiff !== 0) return rankDiff;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })
    .slice(0, 5);

  return {
    project: serializeProject(project),
    currentScope: serializeScopeVersion(currentScope),
    pinnedDecisions: pinnedDecisions.map(serializeDecision),
    recentDecisions: recentDecisionsUnderCurrentScope.map(serializeDecision),
    outstandingIssues: sortedOutstandingIssues.map(serializeIssue),
  };
}

export async function getProjectScopeTimeline(userId: string, projectId: string) {
  const project = await getOwnedProjectOrThrow(userId, projectId);

  const [scopeVersions, decisions] = await Promise.all([
    prisma.scopeVersion.findMany({
      where: { projectId },
      orderBy: { versionNumber: 'asc' },
    }),
    prisma.decisionRecord.findMany({
      where: { projectId },
      include: {
        scopeVersion: {
          select: {
            id: true,
            versionNumber: true,
            reasonForChange: true,
            createdAt: true,
          },
        },
        issue: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const decisionsByScopeId = new Map<string, ReturnType<typeof serializeDecision>[]>();
  for (const d of decisions) {
    const list = decisionsByScopeId.get(d.scopeVersionId) ?? [];
    list.push(serializeDecision(d));
    decisionsByScopeId.set(d.scopeVersionId, list);
  }

  const timelineVersions = scopeVersions.map((sv) => ({
    ...serializeScopeVersion(sv),
    isCurrent:
      scopeVersions.length > 0 &&
      sv.versionNumber === scopeVersions[scopeVersions.length - 1].versionNumber,
    decisions: decisionsByScopeId.get(sv.id) ?? [],
  }));

  return {
    project: serializeProject(project),
    versions: timelineVersions,
  };
}

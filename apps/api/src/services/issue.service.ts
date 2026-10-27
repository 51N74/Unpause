import type { Prisma } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import {
  type ApiIssuePriority,
  type ApiIssueStatus,
  serializeDecision,
  serializeIssue,
  toPrismaIssueStatus,
} from '../lib/serializers.js';
import {
  getActiveOwnedProjectOrThrow,
  getOwnedProjectOrThrow,
} from './project.service.js';

export async function listProjectIssues(
  userId: string,
  projectId: string,
  query: {
    status?: ApiIssueStatus;
    priority?: ApiIssuePriority;
    search?: string;
    page: number;
    pageSize: number;
  }
) {
  await getOwnedProjectOrThrow(userId, projectId);

  const where: Prisma.IssueWhereInput = {
    projectId,
  };

  if (query.status) {
    where.status = toPrismaIssueStatus(query.status);
  }

  if (query.priority) {
    where.priority = query.priority;
  }

  if (query.search && query.search.trim().length > 0) {
    const q = query.search.trim();
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { nextAction: { contains: q, mode: 'insensitive' } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;

  const [total, items] = await Promise.all([
    prisma.issue.count({ where }),
    prisma.issue.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  return {
    items: items.map(serializeIssue),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages,
  };
}

export async function createIssue(
  userId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    status: ApiIssueStatus;
    priority: ApiIssuePriority;
    nextAction: string;
  }
) {
  await getActiveOwnedProjectOrThrow(userId, projectId);

  const issue = await prisma.$transaction(async (tx) => {
    const created = await tx.issue.create({
      data: {
        projectId,
        title: input.title,
        description: input.description ?? '',
        status: toPrismaIssueStatus(input.status),
        priority: input.priority,
        nextAction: input.nextAction,
      },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    return created;
  });

  return serializeIssue(issue);
}

export async function getIssueById(
  userId: string,
  projectId: string,
  issueId: string
) {
  await getOwnedProjectOrThrow(userId, projectId);

  const issue = await prisma.issue.findFirst({
    where: {
      id: issueId,
      projectId,
    },
    include: {
      decisionRecords: {
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
      },
    },
  });

  if (!issue) {
    throw Errors.notFound('Issue not found');
  }

  return {
    ...serializeIssue(issue),
    decisionRecords: issue.decisionRecords.map(serializeDecision),
  };
}

export async function updateIssue(
  userId: string,
  projectId: string,
  issueId: string,
  input: {
    title?: string;
    description?: string;
    status?: ApiIssueStatus;
    priority?: ApiIssuePriority;
    nextAction?: string;
  }
) {
  await getActiveOwnedProjectOrThrow(userId, projectId);

  const existing = await prisma.issue.findFirst({
    where: {
      id: issueId,
      projectId,
    },
  });

  if (!existing) {
    throw Errors.notFound('Issue not found');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.issue.update({
      where: { id: issueId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.status !== undefined
          ? { status: toPrismaIssueStatus(input.status) }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.nextAction !== undefined
          ? { nextAction: input.nextAction }
          : {}),
      },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    return saved;
  });

  return serializeIssue(updated);
}

export async function deleteIssue(
  userId: string,
  projectId: string,
  issueId: string
) {
  await getActiveOwnedProjectOrThrow(userId, projectId);

  const existing = await prisma.issue.findFirst({
    where: {
      id: issueId,
      projectId,
    },
  });

  if (!existing) {
    throw Errors.notFound('Issue not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.issue.delete({
      where: { id: issueId },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  });

  return { deleted: true };
}

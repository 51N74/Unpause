import type { Prisma } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import {
  type ApiScopeImpact,
  serializeDecision,
  toPrismaScopeImpact,
} from '../lib/serializers.js';
import {
  getActiveOwnedProjectOrThrow,
  getOwnedProjectOrThrow,
} from './project.service.js';

const DECISION_INCLUDES = {
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
} as const;

export async function listProjectDecisions(
  userId: string,
  projectId: string,
  query: {
    search?: string;
    scopeImpact?: ApiScopeImpact;
    scopeVersionId?: string;
    pinnedOnly?: boolean;
  }
) {
  await getOwnedProjectOrThrow(userId, projectId);

  const where: Prisma.DecisionRecordWhereInput = {
    projectId,
  };

  if (query.scopeImpact) {
    where.scopeImpact = toPrismaScopeImpact(query.scopeImpact);
  }

  if (query.scopeVersionId && query.scopeVersionId.length > 0) {
    where.scopeVersionId = query.scopeVersionId;
  }

  if (query.pinnedOnly) {
    where.isPinned = true;
  }

  if (query.search && query.search.trim().length > 0) {
    const q = query.search.trim();
    where.OR = [
      { problem: { contains: q, mode: 'insensitive' } },
      { decision: { contains: q, mode: 'insensitive' } },
    ];
  }

  const decisions = await prisma.decisionRecord.findMany({
    where,
    include: DECISION_INCLUDES,
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
  });

  return decisions.map(serializeDecision);
}

export async function createDecisionRecord(
  userId: string,
  projectId: string,
  input: {
    problem: string;
    decision: string;
    rationale: string;
    alternativesConsidered?: string;
    outcome?: string;
    scopeImpact: ApiScopeImpact;
    issueId?: string | null;
  }
) {
  const project = await getActiveOwnedProjectOrThrow(userId, projectId);
  const currentScope = project.scopeVersions[0];
  if (!currentScope) {
    throw Errors.validation('Project does not have an active scope version');
  }

  if (input.issueId) {
    const issue = await prisma.issue.findFirst({
      where: {
        id: input.issueId,
        projectId,
      },
    });
    if (!issue) {
      throw Errors.validation('Linked issue does not exist in this project');
    }
  }

  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.decisionRecord.create({
      data: {
        projectId,
        scopeVersionId: currentScope.id, // Automatically bound to current ScopeVersion
        issueId: input.issueId ?? null,
        problem: input.problem,
        decision: input.decision,
        rationale: input.rationale,
        alternativesConsidered: input.alternativesConsidered ?? '',
        outcome: input.outcome ?? '',
        scopeImpact: toPrismaScopeImpact(input.scopeImpact),
        createdAt: now,
        updatedAt: now,
      },
      include: DECISION_INCLUDES,
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: now },
    });

    return record;
  });

  return serializeDecision(created);
}

export async function getDecisionRecordById(
  userId: string,
  projectId: string,
  decisionId: string
) {
  await getOwnedProjectOrThrow(userId, projectId);

  const decision = await prisma.decisionRecord.findFirst({
    where: {
      id: decisionId,
      projectId,
    },
    include: DECISION_INCLUDES,
  });

  if (!decision) {
    throw Errors.notFound('Decision record not found');
  }

  return serializeDecision(decision);
}

export async function updateDecisionRecord(
  userId: string,
  projectId: string,
  decisionId: string,
  input: {
    problem?: string;
    decision?: string;
    rationale?: string;
    alternativesConsidered?: string;
    outcome?: string;
    scopeImpact?: ApiScopeImpact;
    issueId?: string | null;
  }
) {
  await getActiveOwnedProjectOrThrow(userId, projectId);

  const existing = await prisma.decisionRecord.findFirst({
    where: {
      id: decisionId,
      projectId,
    },
  });

  if (!existing) {
    throw Errors.notFound('Decision record not found');
  }

  if (input.issueId) {
    const issue = await prisma.issue.findFirst({
      where: {
        id: input.issueId,
        projectId,
      },
    });
    if (!issue) {
      throw Errors.validation('Linked issue does not exist in this project');
    }
  }

  const now = new Date();
  // Note: scopeVersionId is NEVER modified during edits!
  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.decisionRecord.update({
      where: { id: decisionId },
      data: {
        ...(input.problem !== undefined ? { problem: input.problem } : {}),
        ...(input.decision !== undefined ? { decision: input.decision } : {}),
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
        ...(input.alternativesConsidered !== undefined
          ? { alternativesConsidered: input.alternativesConsidered }
          : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(input.scopeImpact !== undefined
          ? { scopeImpact: toPrismaScopeImpact(input.scopeImpact) }
          : {}),
        ...(input.issueId !== undefined ? { issueId: input.issueId } : {}),
        updatedAt: now,
      },
      include: DECISION_INCLUDES,
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: now },
    });

    return record;
  });

  return serializeDecision(updated);
}

export async function setDecisionRecordPinned(
  userId: string,
  projectId: string,
  decisionId: string,
  isPinned: boolean
) {
  await getActiveOwnedProjectOrThrow(userId, projectId);

  const existing = await prisma.decisionRecord.findFirst({
    where: {
      id: decisionId,
      projectId,
    },
  });

  if (!existing) {
    throw Errors.notFound('Decision record not found');
  }

  // CRITICAL: Pin/unpin MUST NOT modify the content-modified timestamp (updatedAt)!
  const updated = await prisma.decisionRecord.update({
    where: { id: decisionId },
    data: {
      isPinned,
      pinnedAt: isPinned ? new Date() : null,
    },
    include: DECISION_INCLUDES,
  });

  return serializeDecision(updated);
}

export async function deleteDecisionRecord(
  userId: string,
  projectId: string,
  decisionId: string
) {
  await getActiveOwnedProjectOrThrow(userId, projectId);

  const existing = await prisma.decisionRecord.findFirst({
    where: {
      id: decisionId,
      projectId,
    },
  });

  if (!existing) {
    throw Errors.notFound('Decision record not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.decisionRecord.delete({
      where: { id: decisionId },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  });

  return { deleted: true };
}

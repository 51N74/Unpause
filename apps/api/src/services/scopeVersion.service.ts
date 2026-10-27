import { Errors } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { serializeScopeVersion } from '../lib/serializers.js';
import {
  getActiveOwnedProjectOrThrow,
  getOwnedProjectOrThrow,
} from './project.service.js';

export async function listScopeVersions(userId: string, projectId: string) {
  await getOwnedProjectOrThrow(userId, projectId);

  const versions = await prisma.scopeVersion.findMany({
    where: { projectId },
    orderBy: { versionNumber: 'desc' },
  });

  return {
    currentScope: versions[0] ? serializeScopeVersion(versions[0]) : null,
    versions: versions.map(serializeScopeVersion),
  };
}

export async function createNewScopeVersion(
  userId: string,
  projectId: string,
  input: {
    problem: string;
    targetUsers: string;
    goal: string;
    inScope: string;
    outOfScope: string;
    reasonForChange: string;
  }
) {
  const project = await getActiveOwnedProjectOrThrow(userId, projectId);
  const latestVersion = project.scopeVersions[0]?.versionNumber ?? 0;
  const nextVersionNumber = latestVersion + 1;

  const created = await prisma.$transaction(async (tx) => {
    const sv = await tx.scopeVersion.create({
      data: {
        projectId,
        versionNumber: nextVersionNumber,
        problem: input.problem,
        targetUsers: input.targetUsers,
        goal: input.goal,
        inScope: input.inScope,
        outOfScope: input.outOfScope,
        reasonForChange: input.reasonForChange,
      },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    return sv;
  });

  return serializeScopeVersion(created);
}

export async function getScopeVersionById(
  userId: string,
  projectId: string,
  versionId: string
) {
  await getOwnedProjectOrThrow(userId, projectId);

  const sv = await prisma.scopeVersion.findFirst({
    where: {
      id: versionId,
      projectId,
    },
  });

  if (!sv) {
    throw Errors.notFound('Scope version not found');
  }

  return serializeScopeVersion(sv);
}

import { Router } from 'express';
import { Errors } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createDecisionSchema,
  createIssueSchema,
  createProjectSchema,
  createScopeVersionSchema,
  listDecisionsQuerySchema,
  listIssuesQuerySchema,
  listProjectsQuerySchema,
  pinDecisionSchema,
  updateDecisionSchema,
  updateIssueSchema,
  updateProjectSchema,
} from '../schemas/validation.js';
import {
  createDecisionRecord,
  deleteDecisionRecord,
  getDecisionRecordById,
  listProjectDecisions,
  setDecisionRecordPinned,
  updateDecisionRecord,
} from '../services/decision.service.js';
import {
  createIssue,
  deleteIssue,
  getIssueById,
  listProjectIssues,
  updateIssue,
} from '../services/issue.service.js';
import {
  archiveProject,
  createProjectWithInitialScope,
  getProjectDetail,
  getProjectResumeContext,
  getProjectScopeTimeline,
  listUserProjects,
  restoreProject,
  updateProjectDetails,
} from '../services/project.service.js';
import {
  createNewScopeVersion,
  getScopeVersionById,
  listScopeVersions,
} from '../services/scopeVersion.service.js';

export const projectsRouter = Router();

projectsRouter.use('/projects', requireAuth);

// --- Projects ---
projectsRouter.get('/projects', async (req, res, next) => {
  try {
    const query = listProjectsQuerySchema.parse(req.query);
    const projects = await listUserProjects(req.user!.id, query);
    res.status(200).json({ projects });
  } catch (err) {
    next(err);
  }
});

projectsRouter.post('/projects', async (req, res, next) => {
  try {
    const input = createProjectSchema.parse(req.body);
    const result = await createProjectWithInitialScope(req.user!.id, input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/projects/:projectId', async (req, res, next) => {
  try {
    const project = await getProjectDetail(req.user!.id, req.params.projectId);
    res.status(200).json({ project });
  } catch (err) {
    next(err);
  }
});

const handleUpdateProject = async (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction
) => {
  try {
    const input = updateProjectSchema.parse(req.body);
    const project = await updateProjectDetails(
      req.user!.id,
      req.params.projectId,
      input
    );
    res.status(200).json({ project });
  } catch (err) {
    next(err);
  }
};

projectsRouter.patch('/projects/:projectId', handleUpdateProject);
projectsRouter.put('/projects/:projectId', handleUpdateProject);

projectsRouter.post('/projects/:projectId/archive', async (req, res, next) => {
  try {
    const project = await archiveProject(req.user!.id, req.params.projectId);
    res.status(200).json({ project });
  } catch (err) {
    next(err);
  }
});

projectsRouter.post('/projects/:projectId/restore', async (req, res, next) => {
  try {
    const project = await restoreProject(req.user!.id, req.params.projectId);
    res.status(200).json({ project });
  } catch (err) {
    next(err);
  }
});

// --- Resume Context & Scope Timeline ---
projectsRouter.get(
  '/projects/:projectId/resume-context',
  async (req, res, next) => {
    try {
      const data = await getProjectResumeContext(
        req.user!.id,
        req.params.projectId
      );
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  }
);

projectsRouter.get('/projects/:projectId/timeline', async (req, res, next) => {
  try {
    const data = await getProjectScopeTimeline(
      req.user!.id,
      req.params.projectId
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

// --- Scope Versions (Immutable) ---
projectsRouter.get(
  '/projects/:projectId/scope-versions',
  async (req, res, next) => {
    try {
      const data = await listScopeVersions(req.user!.id, req.params.projectId);
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  }
);

projectsRouter.post(
  '/projects/:projectId/scope-versions',
  async (req, res, next) => {
    try {
      const input = createScopeVersionSchema.parse(req.body);
      const scopeVersion = await createNewScopeVersion(
        req.user!.id,
        req.params.projectId,
        input
      );
      res.status(201).json({ scopeVersion });
    } catch (err) {
      next(err);
    }
  }
);

projectsRouter.get(
  '/projects/:projectId/scope-versions/:versionId',
  async (req, res, next) => {
    try {
      const scopeVersion = await getScopeVersionById(
        req.user!.id,
        req.params.projectId,
        req.params.versionId
      );
      res.status(200).json({ scopeVersion });
    } catch (err) {
      next(err);
    }
  }
);

const rejectImmutableScopeVersion = (
  _req: import('express').Request,
  _res: import('express').Response,
  next: import('express').NextFunction
) => {
  next(Errors.scopeVersionImmutable());
};

projectsRouter.put(
  '/projects/:projectId/scope-versions/:versionId',
  rejectImmutableScopeVersion
);
projectsRouter.patch(
  '/projects/:projectId/scope-versions/:versionId',
  rejectImmutableScopeVersion
);
projectsRouter.delete(
  '/projects/:projectId/scope-versions/:versionId',
  rejectImmutableScopeVersion
);

// --- Issues ---
projectsRouter.get('/projects/:projectId/issues', async (req, res, next) => {
  try {
    const query = listIssuesQuerySchema.parse(req.query);
    const data = await listProjectIssues(
      req.user!.id,
      req.params.projectId,
      query
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

projectsRouter.post('/projects/:projectId/issues', async (req, res, next) => {
  try {
    const input = createIssueSchema.parse(req.body);
    const issue = await createIssue(req.user!.id, req.params.projectId, input);
    res.status(201).json({ issue });
  } catch (err) {
    next(err);
  }
});

projectsRouter.get(
  '/projects/:projectId/issues/:issueId',
  async (req, res, next) => {
    try {
      const issue = await getIssueById(
        req.user!.id,
        req.params.projectId,
        req.params.issueId
      );
      res.status(200).json({ issue });
    } catch (err) {
      next(err);
    }
  }
);

const handleUpdateIssue = async (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction
) => {
  try {
    const input = updateIssueSchema.parse(req.body);
    const issue = await updateIssue(
      req.user!.id,
      req.params.projectId,
      req.params.issueId,
      input
    );
    res.status(200).json({ issue });
  } catch (err) {
    next(err);
  }
};

projectsRouter.patch('/projects/:projectId/issues/:issueId', handleUpdateIssue);
projectsRouter.put('/projects/:projectId/issues/:issueId', handleUpdateIssue);

projectsRouter.delete(
  '/projects/:projectId/issues/:issueId',
  async (req, res, next) => {
    try {
      const result = await deleteIssue(
        req.user!.id,
        req.params.projectId,
        req.params.issueId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// --- Decision Records ---
projectsRouter.get('/projects/:projectId/decisions', async (req, res, next) => {
  try {
    const query = listDecisionsQuerySchema.parse(req.query);
    const decisions = await listProjectDecisions(
      req.user!.id,
      req.params.projectId,
      query
    );
    res.status(200).json({ decisions });
  } catch (err) {
    next(err);
  }
});

projectsRouter.post(
  '/projects/:projectId/decisions',
  async (req, res, next) => {
    try {
      const input = createDecisionSchema.parse(req.body);
      const decision = await createDecisionRecord(
        req.user!.id,
        req.params.projectId,
        input
      );
      res.status(201).json({ decision });
    } catch (err) {
      next(err);
    }
  }
);

projectsRouter.get(
  '/projects/:projectId/decisions/:decisionId',
  async (req, res, next) => {
    try {
      const decision = await getDecisionRecordById(
        req.user!.id,
        req.params.projectId,
        req.params.decisionId
      );
      res.status(200).json({ decision });
    } catch (err) {
      next(err);
    }
  }
);

const handleUpdateDecision = async (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction
) => {
  try {
    const input = updateDecisionSchema.parse(req.body);
    const decision = await updateDecisionRecord(
      req.user!.id,
      req.params.projectId,
      req.params.decisionId,
      input
    );
    res.status(200).json({ decision });
  } catch (err) {
    next(err);
  }
};

projectsRouter.patch(
  '/projects/:projectId/decisions/:decisionId',
  handleUpdateDecision
);
projectsRouter.put(
  '/projects/:projectId/decisions/:decisionId',
  handleUpdateDecision
);

projectsRouter.patch(
  '/projects/:projectId/decisions/:decisionId/pin',
  async (req, res, next) => {
    try {
      const input = pinDecisionSchema.parse(req.body);
      const decision = await setDecisionRecordPinned(
        req.user!.id,
        req.params.projectId,
        req.params.decisionId,
        input.isPinned
      );
      res.status(200).json({ decision });
    } catch (err) {
      next(err);
    }
  }
);

projectsRouter.delete(
  '/projects/:projectId/decisions/:decisionId',
  async (req, res, next) => {
    try {
      const result = await deleteDecisionRecord(
        req.user!.id,
        req.params.projectId,
        req.params.decisionId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

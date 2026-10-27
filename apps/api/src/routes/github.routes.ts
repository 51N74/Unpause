import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { githubSearchQuerySchema } from '../schemas/validation.js';
import { searchGitHubRepositories } from '../services/github.service.js';

export const githubRouter = Router();

githubRouter.get('/github/repositories', requireAuth, async (req, res, next) => {
  try {
    const query = githubSearchQuerySchema.parse(req.query);
    const results = await searchGitHubRepositories(query);
    res.status(200).json(results);
  } catch (err) {
    next(err);
  }
});

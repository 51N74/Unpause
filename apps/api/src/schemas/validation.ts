import { z } from 'zod';

const nonEmptyTrimmed = (fieldLabel: string, max = 5000) =>
  z
    .string({ required_error: `${fieldLabel} is required` })
    .trim()
    .min(1, `${fieldLabel} is required`)
    .max(max, `${fieldLabel} must be at most ${max} characters`);

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .email('Please provide a valid email address')
    .transform((v) => v.toLowerCase()),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name cannot be empty')
    .max(80, 'Display name must be at most 80 characters')
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .email('Please provide a valid email address')
    .transform((v) => v.toLowerCase()),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

export const updateProfileSchema = z.object({
  displayName: nonEmptyTrimmed('Display name', 80),
});

export const initialScopeFieldsSchema = z.object({
  problem: nonEmptyTrimmed('Problem'),
  targetUsers: nonEmptyTrimmed('Target users'),
  goal: nonEmptyTrimmed('Goal'),
  inScope: nonEmptyTrimmed('In-scope items'),
  outOfScope: nonEmptyTrimmed('Out-of-scope items'),
});

export const createProjectSchema = z.object({
  name: nonEmptyTrimmed('Project name', 120),
  description: z
    .string()
    .trim()
    .max(2000, 'Description must be at most 2000 characters')
    .optional()
    .default(''),
  initialScope: initialScopeFieldsSchema,
});

export const updateProjectSchema = z
  .object({
    name: nonEmptyTrimmed('Project name', 120).optional(),
    description: z
      .string()
      .trim()
      .max(2000, 'Description must be at most 2000 characters')
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one project field must be provided for update',
  });

export const listProjectsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(['Active', 'Archived', 'All']).optional().default('Active'),
});

export const createScopeVersionSchema = initialScopeFieldsSchema.extend({
  reasonForChange: nonEmptyTrimmed('Reason for change', 2000),
});

export const issueStatusSchema = z.enum(['Open', 'In Progress', 'Closed']);
export const issuePrioritySchema = z.enum(['High', 'Medium', 'Low']);

export const createIssueSchema = z.object({
  title: nonEmptyTrimmed('Issue title', 200),
  description: z
    .string()
    .trim()
    .max(5000, 'Description must be at most 5000 characters')
    .optional()
    .default(''),
  status: issueStatusSchema.optional().default('Open'),
  priority: issuePrioritySchema.optional().default('Medium'),
  nextAction: nonEmptyTrimmed('Next action', 500),
});

export const updateIssueSchema = z
  .object({
    title: nonEmptyTrimmed('Issue title', 200).optional(),
    description: z
      .string()
      .trim()
      .max(5000, 'Description must be at most 5000 characters')
      .optional(),
    status: issueStatusSchema.optional(),
    priority: issuePrioritySchema.optional(),
    nextAction: nonEmptyTrimmed('Next action', 500).optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.status !== undefined ||
      data.priority !== undefined ||
      data.nextAction !== undefined,
    { message: 'At least one issue field must be provided for update' }
  );

export const listIssuesQuerySchema = z.object({
  status: issueStatusSchema.optional(),
  priority: issuePrioritySchema.optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const scopeImpactSchema = z.enum([
  'None',
  'Expands',
  'Narrows',
  'Changes direction',
]);

export const createDecisionSchema = z.object({
  problem: nonEmptyTrimmed('Problem'),
  decision: nonEmptyTrimmed('Decision'),
  rationale: nonEmptyTrimmed('Rationale'),
  alternativesConsidered: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .default(''),
  outcome: z.string().trim().max(5000).optional().default(''),
  scopeImpact: scopeImpactSchema.default('None'),
  issueId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const updateDecisionSchema = z
  .object({
    problem: nonEmptyTrimmed('Problem').optional(),
    decision: nonEmptyTrimmed('Decision').optional(),
    rationale: nonEmptyTrimmed('Rationale').optional(),
    alternativesConsidered: z.string().trim().max(5000).optional(),
    outcome: z.string().trim().max(5000).optional(),
    scopeImpact: scopeImpactSchema.optional(),
    issueId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null)),
  })
  .refine(
    (data) =>
      data.problem !== undefined ||
      data.decision !== undefined ||
      data.rationale !== undefined ||
      data.alternativesConsidered !== undefined ||
      data.outcome !== undefined ||
      data.scopeImpact !== undefined ||
      data.issueId !== undefined,
    { message: 'At least one decision field must be provided for update' }
  );

export const pinDecisionSchema = z.object({
  isPinned: z.boolean({ required_error: 'isPinned boolean is required' }),
});

export const listDecisionsQuerySchema = z.object({
  search: z.string().trim().optional(),
  scopeImpact: scopeImpactSchema.optional(),
  scopeVersionId: z.string().trim().optional(),
  pinnedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const githubSearchQuerySchema = z.object({
  q: nonEmptyTrimmed('Search query', 200),
  language: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  minStars: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return undefined;
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error('minStars must be a non-negative integer');
      }
      return n;
    }),
  page: z.coerce.number().int().min(1).max(100).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(30).optional().default(10),
});

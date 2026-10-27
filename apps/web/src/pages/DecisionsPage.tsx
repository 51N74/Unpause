import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LinkIcon from '@mui/icons-material/Link';
import { useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { decisionsApi, issuesApi, projectsApi } from '../api/endpoints';
import { extractApiError } from '../api/client';
import { ErrorState } from '../components/ErrorState';
import { ScopeImpactChip } from '../components/Badges';
import { formatBangkokDateTime } from '../utils/date';
import type { DecisionRecord, ScopeImpact } from '../types/api';

const decisionFormSchema = z.object({
  problem: z.string().trim().min(1, 'Problem is required'),
  decision: z.string().trim().min(1, 'Decision is required'),
  rationale: z.string().trim().min(1, 'Rationale is required'),
  alternativesConsidered: z.string().trim().max(5000),
  outcome: z.string().trim().max(5000),
  scopeImpact: z.enum(['None', 'Expands', 'Narrows', 'Changes direction']),
  issueId: z.string().optional(),
});

type DecisionFormValues = z.infer<typeof decisionFormSchema>;

export const DecisionsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [impactFilter, setImpactFilter] = useState<ScopeImpact | 'All'>('All');
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDecision, setSelectedDecision] =
    useState<DecisionRecord | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DecisionRecord | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId, 'header'],
    queryFn: () => projectsApi.getById(projectId!),
    enabled: Boolean(projectId),
  });

  const decisionsQuery = useQuery({
    queryKey: [
      'project',
      projectId,
      'decisions',
      {
        search: searchInput.trim(),
        scopeImpact: impactFilter,
        pinnedOnly,
      },
    ],
    queryFn: () =>
      decisionsApi.list(projectId!, {
        search: searchInput.trim() || undefined,
        scopeImpact: impactFilter === 'All' ? undefined : impactFilter,
        pinnedOnly: pinnedOnly ? true : undefined,
      }),
    enabled: Boolean(projectId),
  });

  const issuesListQuery = useQuery({
    queryKey: ['project', projectId, 'issues-dropdown'],
    queryFn: () => issuesApi.list(projectId!, { page: 1, pageSize: 50 }),
    enabled: Boolean(projectId),
  });

  const createForm = useForm<DecisionFormValues>({
    resolver: zodResolver(decisionFormSchema),
    defaultValues: {
      problem: '',
      decision: '',
      rationale: '',
      alternativesConsidered: '',
      outcome: '',
      scopeImpact: 'None',
      issueId: '',
    },
  });

  const editForm = useForm<DecisionFormValues>({
    resolver: zodResolver(decisionFormSchema),
    defaultValues: {
      problem: '',
      decision: '',
      rationale: '',
      alternativesConsidered: '',
      outcome: '',
      scopeImpact: 'None',
      issueId: '',
    },
  });

  useEffect(() => {
    if (selectedDecision) {
      editForm.reset({
        problem: selectedDecision.problem,
        decision: selectedDecision.decision,
        rationale: selectedDecision.rationale,
        alternativesConsidered: selectedDecision.alternativesConsidered ?? '',
        outcome: selectedDecision.outcome ?? '',
        scopeImpact: selectedDecision.scopeImpact,
        issueId: selectedDecision.issueId ?? '',
      });
    }
  }, [selectedDecision, editForm]);

  const invalidateDecisionCaches = () => {
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: DecisionFormValues) =>
      decisionsApi.create(projectId!, {
        problem: values.problem,
        decision: values.decision,
        rationale: values.rationale,
        alternativesConsidered: values.alternativesConsidered,
        outcome: values.outcome,
        scopeImpact: values.scopeImpact,
        issueId: values.issueId ? values.issueId : null,
      }),
    onSuccess: (data) => {
      invalidateDecisionCaches();
      setCreateOpen(false);
      createForm.reset();
      setFeedback(
        `Decision recorded and bound to Scope v${data.decision.scopeVersion?.versionNumber ?? projectQuery.data?.project.currentScopeVersion}.`
      );
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setFormError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      decisionId,
      values,
    }: {
      decisionId: string;
      values: DecisionFormValues;
    }) =>
      decisionsApi.update(projectId!, decisionId, {
        problem: values.problem,
        decision: values.decision,
        rationale: values.rationale,
        alternativesConsidered: values.alternativesConsidered,
        outcome: values.outcome,
        scopeImpact: values.scopeImpact,
        issueId: values.issueId ? values.issueId : null,
      }),
    onSuccess: (data) => {
      invalidateDecisionCaches();
      setSelectedDecision(data.decision);
      setIsEditMode(false);
      setFeedback('Decision record updated.');
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setFormError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
    },
  });

  const pinMutation = useMutation({
    mutationFn: ({
      decisionId,
      isPinned,
    }: {
      decisionId: string;
      isPinned: boolean;
    }) => decisionsApi.setPinned(projectId!, decisionId, isPinned),
    onSuccess: (data) => {
      invalidateDecisionCaches();
      if (selectedDecision?.id === data.decision.id) {
        setSelectedDecision(data.decision);
      }
      setFeedback(
        data.decision.isPinned ? 'Decision pinned.' : 'Decision unpinned.'
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (decisionId: string) =>
      decisionsApi.remove(projectId!, decisionId),
    onSuccess: () => {
      invalidateDecisionCaches();
      if (selectedDecision && deleteTarget?.id === selectedDecision.id) {
        setSelectedDecision(null);
      }
      setDeleteTarget(null);
      setFeedback('Decision record deleted.');
    },
  });

  const currentProject = projectQuery.data?.project;
  const isReadOnly = currentProject?.status === 'Archived';

  const handleSaveEdit = (values: DecisionFormValues) => {
    if (!selectedDecision) return;

    const noChanges =
      values.problem.trim() === selectedDecision.problem &&
      values.decision.trim() === selectedDecision.decision &&
      values.rationale.trim() === selectedDecision.rationale &&
      values.alternativesConsidered.trim() ===
        (selectedDecision.alternativesConsidered ?? '') &&
      values.outcome.trim() === (selectedDecision.outcome ?? '') &&
      values.scopeImpact === selectedDecision.scopeImpact &&
      (values.issueId || null) === (selectedDecision.issueId ?? null);

    if (noChanges) {
      setIsEditMode(false);
      return;
    }

    setFormError(null);
    updateMutation.mutate({
      decisionId: selectedDecision.id,
      values,
    });
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Decision Records
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every decision is automatically and permanently linked to the project
            Scope Version active when it was created.
          </Typography>
        </Box>
        {!isReadOnly && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setFormError(null);
              createForm.reset({
                problem: '',
                decision: '',
                rationale: '',
                alternativesConsidered: '',
                outcome: '',
                scopeImpact: 'None',
                issueId: '',
              });
              setCreateOpen(true);
            }}
          >
            Record Decision
          </Button>
        )}
      </Stack>

      {/* Search & Filters */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            size="small"
            label="Keyword search over problem and decision text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            fullWidth
          />
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="decision-impact-filter">Scope Impact</InputLabel>
            <Select
              labelId="decision-impact-filter"
              label="Scope Impact"
              value={impactFilter}
              onChange={(e) =>
                setImpactFilter(e.target.value as ScopeImpact | 'All')
              }
            >
              <MenuItem value="All">All Scope Impacts</MenuItem>
              <MenuItem value="None">None</MenuItem>
              <MenuItem value="Expands">Expands</MenuItem>
              <MenuItem value="Narrows">Narrows</MenuItem>
              <MenuItem value="Changes direction">Changes direction</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant={pinnedOnly ? 'contained' : 'outlined'}
            color={pinnedOnly ? 'secondary' : 'inherit'}
            startIcon={<PushPinIcon />}
            onClick={() => setPinnedOnly((prev) => !prev)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {pinnedOnly ? 'Pinned Only' : 'All Decisions'}
          </Button>
        </Stack>
      </Paper>

      {decisionsQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {decisionsQuery.isError && (
        <ErrorState
          title="Unable to load Decision Records"
          error={decisionsQuery.error}
          onRetry={() => void decisionsQuery.refetch()}
        />
      )}

      {!decisionsQuery.isLoading &&
        !decisionsQuery.isError &&
        decisionsQuery.data && (
          <>
            {decisionsQuery.data.decisions.length === 0 ? (
              <Paper
                elevation={0}
                sx={{
                  p: 5,
                  textAlign: 'center',
                  border: '1px dashed',
                  borderColor: 'divider',
                  borderRadius: 2,
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                  No decision records found
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {searchInput.trim() || impactFilter !== 'All' || pinnedOnly
                    ? 'No decisions match your current search or filters.'
                    : 'Record your architectural and product decisions so your future self knows why choices were made.'}
                </Typography>
                {!isReadOnly && (
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setCreateOpen(true)}
                  >
                    Record First Decision
                  </Button>
                )}
              </Paper>
            ) : (
              <Stack spacing={2}>
                {decisionsQuery.data.decisions.map((dec) => (
                  <Card
                    key={dec.id}
                    elevation={0}
                    sx={{
                      border: '1px solid',
                      borderColor: dec.isPinned ? 'secondary.main' : 'divider',
                      borderRadius: 2,
                    }}
                  >
                    <CardContent>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        justifyContent="space-between"
                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                        spacing={1}
                        sx={{ mb: 1.5 }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          flexWrap="wrap"
                        >
                          <Chip
                            size="small"
                            color="primary"
                            label={`Recorded under Scope v${dec.scopeVersion?.versionNumber ?? '?'}`}
                            sx={{ fontWeight: 700 }}
                          />
                          <ScopeImpactChip impact={dec.scopeImpact} />
                          {dec.isPinned && (
                            <Chip
                              size="small"
                              color="secondary"
                              icon={<PushPinIcon />}
                              label="Pinned"
                            />
                          )}
                          {dec.issue && (
                            <Chip
                              size="small"
                              variant="outlined"
                              icon={<LinkIcon />}
                              label={`Issue: ${dec.issue.title}`}
                            />
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          Content modified: {formatBangkokDateTime(dec.updatedAt)}
                        </Typography>
                      </Stack>

                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                        {dec.decision}
                      </Typography>

                      <Typography variant="body2" sx={{ mb: 0.75 }}>
                        <strong>Problem:</strong> {dec.problem}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 0.75 }}>
                        <strong>Rationale:</strong> {dec.rationale}
                      </Typography>
                      {dec.alternativesConsidered && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mb: 0.5 }}
                        >
                          <strong>Alternatives Considered:</strong>{' '}
                          {dec.alternativesConsidered}
                        </Typography>
                      )}
                      {dec.outcome && (
                        <Typography variant="body2" color="text.secondary">
                          <strong>Outcome:</strong> {dec.outcome}
                        </Typography>
                      )}
                    </CardContent>
                    <Divider />
                    <CardActions
                      sx={{
                        px: 2,
                        py: 1,
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                      }}
                    >
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          startIcon={<VisibilityIcon />}
                          onClick={() => {
                            setFormError(null);
                            setSelectedDecision(dec);
                            setIsEditMode(false);
                          }}
                        >
                          View Details
                        </Button>
                        {!isReadOnly && (
                          <Button
                            size="small"
                            startIcon={<EditIcon />}
                            onClick={() => {
                              setFormError(null);
                              setSelectedDecision(dec);
                              setIsEditMode(true);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </Stack>

                      {!isReadOnly && (
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            color={dec.isPinned ? 'secondary' : 'inherit'}
                            startIcon={
                              dec.isPinned ? (
                                <PushPinIcon />
                              ) : (
                                <PushPinOutlinedIcon />
                              )
                            }
                            disabled={pinMutation.isPending}
                            onClick={() =>
                              pinMutation.mutate({
                                decisionId: dec.id,
                                isPinned: !dec.isPinned,
                              })
                            }
                          >
                            {dec.isPinned ? 'Unpin' : 'Pin'}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={() => setDeleteTarget(dec)}
                          >
                            Delete
                          </Button>
                        </Stack>
                      )}
                    </CardActions>
                  </Card>
                ))}
              </Stack>
            )}
          </>
        )}

      {/* Create Decision Record Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <form
          onSubmit={createForm.handleSubmit((values) => {
            setFormError(null);
            createMutation.mutate(values);
          })}
          noValidate
        >
          <DialogTitle sx={{ fontWeight: 700 }}>
            Record New Decision
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2.5}>
              <Alert severity="info">
                This decision will be automatically associated with{' '}
                <strong>
                  Current Scope Version v
                  {currentProject?.currentScopeVersion ?? 1}
                </strong>
                .
              </Alert>

              {formError && <Alert severity="error">{formError}</Alert>}

              <TextField
                label="Problem *"
                placeholder="What question, constraint, or trade-off needed a decision?"
                fullWidth
                multiline
                minRows={2}
                {...createForm.register('problem')}
                error={Boolean(createForm.formState.errors.problem)}
                helperText={createForm.formState.errors.problem?.message}
              />

              <TextField
                label="Decision *"
                placeholder="What did you decide to do?"
                fullWidth
                multiline
                minRows={2}
                {...createForm.register('decision')}
                error={Boolean(createForm.formState.errors.decision)}
                helperText={createForm.formState.errors.decision?.message}
              />

              <TextField
                label="Rationale *"
                placeholder="Why was this option chosen over others?"
                fullWidth
                multiline
                minRows={2}
                {...createForm.register('rationale')}
                error={Boolean(createForm.formState.errors.rationale)}
                helperText={createForm.formState.errors.rationale?.message}
              />

              <Controller
                control={createForm.control}
                name="scopeImpact"
                render={({ field }) => (
                  <FormControl fullWidth>
                    <InputLabel id="create-decision-impact">
                      Scope Impact Label *
                    </InputLabel>
                    <Select
                      labelId="create-decision-impact"
                      label="Scope Impact Label *"
                      {...field}
                    >
                      <MenuItem value="None">None</MenuItem>
                      <MenuItem value="Expands">Expands</MenuItem>
                      <MenuItem value="Narrows">Narrows</MenuItem>
                      <MenuItem value="Changes direction">
                        Changes direction
                      </MenuItem>
                    </Select>
                  </FormControl>
                )}
              />

              <Controller
                control={createForm.control}
                name="issueId"
                render={({ field }) => (
                  <FormControl fullWidth>
                    <InputLabel id="create-decision-issue">
                      Linked Issue (Optional)
                    </InputLabel>
                    <Select
                      labelId="create-decision-issue"
                      label="Linked Issue (Optional)"
                      {...field}
                    >
                      <MenuItem value="">
                        <em>None</em>
                      </MenuItem>
                      {(issuesListQuery.data?.items ?? []).map((iss) => (
                        <MenuItem key={iss.id} value={iss.id}>
                          {iss.title} ({iss.status})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />

              <TextField
                label="Alternatives Considered (Optional)"
                fullWidth
                multiline
                minRows={2}
                {...createForm.register('alternativesConsidered')}
              />

              <TextField
                label="Outcome (Optional — can be filled in later)"
                fullWidth
                multiline
                minRows={2}
                {...createForm.register('outcome')}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Saving...' : 'Save Decision Record'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* View / Explicit Edit Decision Dialog */}
      <Dialog
        open={Boolean(selectedDecision)}
        onClose={() => {
          setSelectedDecision(null);
          setIsEditMode(false);
        }}
        maxWidth="md"
        fullWidth
      >
        {selectedDecision && !isEditMode && (
          <>
            <DialogTitle sx={{ fontWeight: 700 }}>
              Decision Record Detail
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Chip
                    color="primary"
                    label={`Recorded under Scope Version ${selectedDecision.scopeVersion?.versionNumber ?? '?'}`}
                    sx={{ fontWeight: 700 }}
                  />
                  <ScopeImpactChip impact={selectedDecision.scopeImpact} />
                  {selectedDecision.isPinned && (
                    <Chip
                      color="secondary"
                      icon={<PushPinIcon />}
                      label="Pinned"
                      size="small"
                    />
                  )}
                </Stack>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    DECISION
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {selectedDecision.decision}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    PROBLEM
                  </Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
                    {selectedDecision.problem}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    RATIONALE
                  </Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
                    {selectedDecision.rationale}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    ALTERNATIVES CONSIDERED
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {selectedDecision.alternativesConsidered || '—'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    OUTCOME
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {selectedDecision.outcome || '—'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    LINKED ISSUE
                  </Typography>
                  <Typography variant="body2">
                    {selectedDecision.issue
                      ? `${selectedDecision.issue.title} (${selectedDecision.issue.status})`
                      : 'None'}
                  </Typography>
                </Box>

                <Divider />
                <Typography variant="caption" color="text.secondary">
                  Created: {formatBangkokDateTime(selectedDecision.createdAt)} •
                  Content Last Modified:{' '}
                  {formatBangkokDateTime(selectedDecision.updatedAt)}
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button onClick={() => setSelectedDecision(null)}>Close</Button>
              {!isReadOnly && (
                <Button
                  variant="contained"
                  startIcon={<EditIcon />}
                  onClick={() => setIsEditMode(true)}
                >
                  Edit Decision
                </Button>
              )}
            </DialogActions>
          </>
        )}

        {selectedDecision && isEditMode && (
          <form onSubmit={editForm.handleSubmit(handleSaveEdit)} noValidate>
            <DialogTitle sx={{ fontWeight: 700 }}>
              Edit Decision Record
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2.5}>
                <Alert severity="info">
                  Originally recorded under{' '}
                  <strong>
                    Scope Version{' '}
                    {selectedDecision.scopeVersion?.versionNumber ?? '?'}
                  </strong>
                  . Editing this decision preserves its original scope version
                  association.
                </Alert>

                {formError && <Alert severity="error">{formError}</Alert>}

                <TextField
                  label="Problem *"
                  fullWidth
                  multiline
                  minRows={2}
                  {...editForm.register('problem')}
                  error={Boolean(editForm.formState.errors.problem)}
                  helperText={editForm.formState.errors.problem?.message}
                />

                <TextField
                  label="Decision *"
                  fullWidth
                  multiline
                  minRows={2}
                  {...editForm.register('decision')}
                  error={Boolean(editForm.formState.errors.decision)}
                  helperText={editForm.formState.errors.decision?.message}
                />

                <TextField
                  label="Rationale *"
                  fullWidth
                  multiline
                  minRows={2}
                  {...editForm.register('rationale')}
                  error={Boolean(editForm.formState.errors.rationale)}
                  helperText={editForm.formState.errors.rationale?.message}
                />

                <Controller
                  control={editForm.control}
                  name="scopeImpact"
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel id="edit-decision-impact">
                        Scope Impact Label *
                      </InputLabel>
                      <Select
                        labelId="edit-decision-impact"
                        label="Scope Impact Label *"
                        {...field}
                      >
                        <MenuItem value="None">None</MenuItem>
                        <MenuItem value="Expands">Expands</MenuItem>
                        <MenuItem value="Narrows">Narrows</MenuItem>
                        <MenuItem value="Changes direction">
                          Changes direction
                        </MenuItem>
                      </Select>
                    </FormControl>
                  )}
                />

                <Controller
                  control={editForm.control}
                  name="issueId"
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel id="edit-decision-issue">
                        Linked Issue (Optional)
                      </InputLabel>
                      <Select
                        labelId="edit-decision-issue"
                        label="Linked Issue (Optional)"
                        {...field}
                      >
                        <MenuItem value="">
                          <em>None</em>
                        </MenuItem>
                        {(issuesListQuery.data?.items ?? []).map((iss) => (
                          <MenuItem key={iss.id} value={iss.id}>
                            {iss.title} ({iss.status})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                />

                <TextField
                  label="Alternatives Considered"
                  fullWidth
                  multiline
                  minRows={2}
                  {...editForm.register('alternativesConsidered')}
                />

                <TextField
                  label="Outcome"
                  fullWidth
                  multiline
                  minRows={2}
                  {...editForm.register('outcome')}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button
                onClick={() => {
                  editForm.reset();
                  setIsEditMode(false);
                }}
                disabled={updateMutation.isPending}
              >
                Cancel Edit
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={
                  !editForm.formState.isDirty || updateMutation.isPending
                }
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      {/* Delete Decision Confirmation */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          Delete Decision Record?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to permanently delete this decision record:{' '}
            <strong>{deleteTarget?.decision}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
            onClick={() =>
              deleteTarget && deleteMutation.mutate(deleteTarget.id)
            }
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Decision'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={4000}
        onClose={() => setFeedback(null)}
        message={feedback}
      />
    </Box>
  );
};

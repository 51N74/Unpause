import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Pagination,
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
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { issuesApi, projectsApi } from '../api/endpoints';
import { extractApiError } from '../api/client';
import { ErrorState } from '../components/ErrorState';
import { IssuePriorityChip, IssueStatusChip } from '../components/Badges';
import { formatBangkokDateTime } from '../utils/date';
import type { Issue, IssuePriority, IssueStatus } from '../types/api';

const issueFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(200, 'Title must be at most 200 characters'),
  description: z
    .string()
    .trim()
    .max(5000, 'Description must be at most 5000 characters'),
  status: z.enum(['Open', 'In Progress', 'Closed']),
  priority: z.enum(['High', 'Medium', 'Low']),
  nextAction: z
    .string()
    .trim()
    .min(1, 'Next action is required')
    .max(500, 'Next action must be at most 500 characters'),
});

type IssueFormValues = z.infer<typeof issueFormSchema>;

export const IssuesPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'All'>('All');
  const [priorityFilter, setPriorityFilter] = useState<IssuePriority | 'All'>('All');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [deleteConfirmIssue, setDeleteConfirmIssue] = useState<Issue | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId, 'header'],
    queryFn: () => projectsApi.getById(projectId!),
    enabled: Boolean(projectId),
  });

  const issuesQuery = useQuery({
    queryKey: [
      'project',
      projectId,
      'issues',
      {
        status: statusFilter,
        priority: priorityFilter,
        search: searchInput.trim(),
        page,
      },
    ],
    queryFn: () =>
      issuesApi.list(projectId!, {
        status: statusFilter === 'All' ? undefined : statusFilter,
        priority: priorityFilter === 'All' ? undefined : priorityFilter,
        search: searchInput.trim() || undefined,
        page,
        pageSize: 20,
      }),
    enabled: Boolean(projectId),
  });

  const createForm = useForm<IssueFormValues>({
    resolver: zodResolver(issueFormSchema),
    defaultValues: {
      title: '',
      description: '',
      status: 'Open',
      priority: 'Medium',
      nextAction: '',
    },
  });

  const editForm = useForm<IssueFormValues>({
    resolver: zodResolver(issueFormSchema),
    defaultValues: {
      title: '',
      description: '',
      status: 'Open',
      priority: 'Medium',
      nextAction: '',
    },
  });

  useEffect(() => {
    if (selectedIssue) {
      editForm.reset({
        title: selectedIssue.title,
        description: selectedIssue.description ?? '',
        status: selectedIssue.status,
        priority: selectedIssue.priority,
        nextAction: selectedIssue.nextAction,
      });
    }
  }, [selectedIssue, editForm]);

  const invalidateIssueCaches = () => {
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: IssueFormValues) =>
      issuesApi.create(projectId!, values),
    onSuccess: () => {
      invalidateIssueCaches();
      setCreateOpen(false);
      createForm.reset();
      setFeedback('Issue created.');
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
      issueId,
      payload,
    }: {
      issueId: string;
      payload: Partial<IssueFormValues>;
    }) => issuesApi.update(projectId!, issueId, payload),
    onSuccess: (data) => {
      invalidateIssueCaches();
      setSelectedIssue(data.issue);
      setIsEditMode(false);
      setFeedback('Issue changes saved.');
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setFormError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.remove(projectId!, issueId),
    onSuccess: () => {
      invalidateIssueCaches();
      setDeleteConfirmIssue(null);
      if (selectedIssue && deleteConfirmIssue?.id === selectedIssue.id) {
        setSelectedIssue(null);
      }
      setFeedback('Issue deleted. Any linked Decision Records were retained.');
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setFeedback(`Delete failed: ${parsed.message}`);
    },
  });

  const isReadOnly = projectQuery.data?.project.status === 'Archived';

  const handleSaveEdit = (values: IssueFormValues) => {
    if (!selectedIssue) return;

    const noChanges =
      values.title.trim() === selectedIssue.title &&
      values.description.trim() === (selectedIssue.description ?? '') &&
      values.status === selectedIssue.status &&
      values.priority === selectedIssue.priority &&
      values.nextAction.trim() === selectedIssue.nextAction;

    // Do not send an unnecessary update request when nothing has changed
    if (noChanges) {
      setIsEditMode(false);
      return;
    }

    setFormError(null);
    updateMutation.mutate({
      issueId: selectedIssue.id,
      payload: values,
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
            Issues & Next Actions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track open problems and the immediate next action required to move
            each issue forward.
          </Typography>
        </Box>
        {!isReadOnly && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setFormError(null);
              createForm.reset({
                title: '',
                description: '',
                status: 'Open',
                priority: 'Medium',
                nextAction: '',
              });
              setCreateOpen(true);
            }}
          >
            New Issue
          </Button>
        )}
      </Stack>

      {/* Filter Bar */}
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
            label="Search issues or next actions"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            fullWidth
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="issue-status-filter-label">Status</InputLabel>
            <Select
              labelId="issue-status-filter-label"
              label="Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as IssueStatus | 'All');
                setPage(1);
              }}
            >
              <MenuItem value="All">All Statuses</MenuItem>
              <MenuItem value="Open">Open</MenuItem>
              <MenuItem value="In Progress">In Progress</MenuItem>
              <MenuItem value="Closed">Closed</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="issue-priority-filter-label">Priority</InputLabel>
            <Select
              labelId="issue-priority-filter-label"
              label="Priority"
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value as IssuePriority | 'All');
                setPage(1);
              }}
            >
              <MenuItem value="All">All Priorities</MenuItem>
              <MenuItem value="High">High</MenuItem>
              <MenuItem value="Medium">Medium</MenuItem>
              <MenuItem value="Low">Low</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {issuesQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {issuesQuery.isError && (
        <ErrorState
          title="Unable to load issues"
          error={issuesQuery.error}
          onRetry={() => void issuesQuery.refetch()}
        />
      )}

      {!issuesQuery.isLoading && !issuesQuery.isError && issuesQuery.data && (
        <>
          {issuesQuery.data.items.length === 0 ? (
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
                No issues found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {statusFilter !== 'All' ||
                priorityFilter !== 'All' ||
                searchInput.trim()
                  ? 'No issues match your current filters.'
                  : 'Create an issue with a concrete next action so you always know where to pick up.'}
              </Typography>
              {!isReadOnly && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreateOpen(true)}
                >
                  Create Issue
                </Button>
              )}
            </Paper>
          ) : (
            <Stack spacing={2}>
              {issuesQuery.data.items.map((issue) => (
                <Card
                  key={issue.id}
                  elevation={0}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                  }}
                >
                  <CardContent>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                      spacing={1}
                      sx={{ mb: 1 }}
                    >
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {issue.title}
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <IssuePriorityChip priority={issue.priority} />
                        <IssueStatusChip status={issue.status} />
                      </Stack>
                    </Stack>

                    {issue.description && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 1.5, whiteSpace: 'pre-line' }}
                      >
                        {issue.description}
                      </Typography>
                    )}

                    <Box
                      sx={{
                        p: 1.5,
                        bgcolor: '#eff6ff',
                        borderRadius: 1,
                        borderLeft: '3px solid',
                        borderColor: 'primary.main',
                        mb: 1,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          color: 'primary.dark',
                          display: 'block',
                        }}
                      >
                        NEXT ACTION
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {issue.nextAction}
                      </Typography>
                    </Box>

                    <Typography variant="caption" color="text.secondary">
                      Last modified: {formatBangkokDateTime(issue.updatedAt)}
                    </Typography>
                  </CardContent>
                  <Divider />
                  <CardActions
                    sx={{
                      px: 2,
                      py: 1,
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 1,
                    }}
                  >
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => {
                          setFormError(null);
                          setSelectedIssue(issue);
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
                            setSelectedIssue(issue);
                            setIsEditMode(true);
                          }}
                        >
                          Edit
                        </Button>
                      )}
                    </Stack>

                    {!isReadOnly && (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 140 }}>
                          <Select
                            value={issue.status}
                            disabled={updateMutation.isPending}
                            onChange={(e) => {
                              const newStatus = e.target.value as IssueStatus;
                              if (newStatus !== issue.status) {
                                updateMutation.mutate({
                                  issueId: issue.id,
                                  payload: { status: newStatus },
                                });
                              }
                            }}
                            sx={{ fontSize: '0.82rem', height: 32 }}
                          >
                            <MenuItem value="Open">Open</MenuItem>
                            <MenuItem value="In Progress">In Progress</MenuItem>
                            <MenuItem value="Closed">Closed</MenuItem>
                          </Select>
                        </FormControl>

                        <Button
                          size="small"
                          color="error"
                          startIcon={<DeleteOutlineIcon />}
                          onClick={() => setDeleteConfirmIssue(issue)}
                        >
                          Delete
                        </Button>
                      </Stack>
                    )}
                  </CardActions>
                </Card>
              ))}

              {issuesQuery.data.totalPages > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
                  <Pagination
                    count={issuesQuery.data.totalPages}
                    page={issuesQuery.data.page}
                    onChange={(_e, value) => setPage(value)}
                    color="primary"
                  />
                </Box>
              )}
            </Stack>
          )}
        </>
      )}

      {/* Create Issue Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <form
          onSubmit={createForm.handleSubmit((values) => {
            setFormError(null);
            createMutation.mutate(values);
          })}
          noValidate
        >
          <DialogTitle sx={{ fontWeight: 700 }}>Create Issue</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2.5}>
              {formError && <Alert severity="error">{formError}</Alert>}

              <TextField
                label="Title *"
                fullWidth
                {...createForm.register('title')}
                error={Boolean(createForm.formState.errors.title)}
                helperText={createForm.formState.errors.title?.message}
              />

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Controller
                    control={createForm.control}
                    name="status"
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <InputLabel id="create-issue-status">Status</InputLabel>
                        <Select
                          labelId="create-issue-status"
                          label="Status"
                          {...field}
                        >
                          <MenuItem value="Open">Open</MenuItem>
                          <MenuItem value="In Progress">In Progress</MenuItem>
                          <MenuItem value="Closed">Closed</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>
                <Grid item xs={6}>
                  <Controller
                    control={createForm.control}
                    name="priority"
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <InputLabel id="create-issue-priority">
                          Priority
                        </InputLabel>
                        <Select
                          labelId="create-issue-priority"
                          label="Priority"
                          {...field}
                        >
                          <MenuItem value="High">High</MenuItem>
                          <MenuItem value="Medium">Medium</MenuItem>
                          <MenuItem value="Low">Low</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>
              </Grid>

              <TextField
                label="Next Action *"
                placeholder="Concrete next step when you resume work on this issue..."
                fullWidth
                {...createForm.register('nextAction')}
                error={Boolean(createForm.formState.errors.nextAction)}
                helperText={createForm.formState.errors.nextAction?.message}
              />

              <TextField
                label="Description (Optional)"
                fullWidth
                multiline
                minRows={3}
                {...createForm.register('description')}
                error={Boolean(createForm.formState.errors.description)}
                helperText={createForm.formState.errors.description?.message}
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
              {createMutation.isPending ? 'Saving...' : 'Save Issue'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Issue Detail / Explicit Edit Dialog */}
      <Dialog
        open={Boolean(selectedIssue)}
        onClose={() => {
          setSelectedIssue(null);
          setIsEditMode(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        {selectedIssue && !isEditMode && (
          <>
            <DialogTitle sx={{ fontWeight: 700 }}>
              Issue Detail (Read-Only)
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1}>
                  <IssuePriorityChip priority={selectedIssue.priority} />
                  <IssueStatusChip status={selectedIssue.status} />
                </Stack>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    TITLE
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {selectedIssue.title}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    p: 1.5,
                    bgcolor: '#eff6ff',
                    borderRadius: 1,
                    borderLeft: '3px solid',
                    borderColor: 'primary.main',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: 'primary.dark' }}
                  >
                    NEXT ACTION
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {selectedIssue.nextAction}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    DESCRIPTION
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                    {selectedIssue.description || 'No description provided.'}
                  </Typography>
                </Box>

                <Divider />
                <Typography variant="caption" color="text.secondary">
                  Created: {formatBangkokDateTime(selectedIssue.createdAt)} •
                  Last modified: {formatBangkokDateTime(selectedIssue.updatedAt)}
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button onClick={() => setSelectedIssue(null)}>Close</Button>
              {!isReadOnly && (
                <Button
                  variant="contained"
                  startIcon={<EditIcon />}
                  onClick={() => setIsEditMode(true)}
                >
                  Edit Issue
                </Button>
              )}
            </DialogActions>
          </>
        )}

        {selectedIssue && isEditMode && (
          <form onSubmit={editForm.handleSubmit(handleSaveEdit)} noValidate>
            <DialogTitle sx={{ fontWeight: 700 }}>Edit Issue</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2.5}>
                {formError && <Alert severity="error">{formError}</Alert>}

                <TextField
                  label="Title *"
                  fullWidth
                  {...editForm.register('title')}
                  error={Boolean(editForm.formState.errors.title)}
                  helperText={editForm.formState.errors.title?.message}
                />

                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Controller
                      control={editForm.control}
                      name="status"
                      render={({ field }) => (
                        <FormControl fullWidth>
                          <InputLabel id="edit-issue-status">Status</InputLabel>
                          <Select
                            labelId="edit-issue-status"
                            label="Status"
                            {...field}
                          >
                            <MenuItem value="Open">Open</MenuItem>
                            <MenuItem value="In Progress">In Progress</MenuItem>
                            <MenuItem value="Closed">Closed</MenuItem>
                          </Select>
                        </FormControl>
                      )}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <Controller
                      control={editForm.control}
                      name="priority"
                      render={({ field }) => (
                        <FormControl fullWidth>
                          <InputLabel id="edit-issue-priority">
                            Priority
                          </InputLabel>
                          <Select
                            labelId="edit-issue-priority"
                            label="Priority"
                            {...field}
                          >
                            <MenuItem value="High">High</MenuItem>
                            <MenuItem value="Medium">Medium</MenuItem>
                            <MenuItem value="Low">Low</MenuItem>
                          </Select>
                        </FormControl>
                      )}
                    />
                  </Grid>
                </Grid>

                <TextField
                  label="Next Action *"
                  fullWidth
                  {...editForm.register('nextAction')}
                  error={Boolean(editForm.formState.errors.nextAction)}
                  helperText={editForm.formState.errors.nextAction?.message}
                />

                <TextField
                  label="Description"
                  fullWidth
                  multiline
                  minRows={3}
                  {...editForm.register('description')}
                  error={Boolean(editForm.formState.errors.description)}
                  helperText={editForm.formState.errors.description?.message}
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

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteConfirmIssue)}
        onClose={() => setDeleteConfirmIssue(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Delete Issue?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to delete{' '}
            <strong>{deleteConfirmIssue?.title}</strong>? Any Decision Records
            linked to this issue will be preserved with their issue link cleared.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setDeleteConfirmIssue(null)}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
            onClick={() =>
              deleteConfirmIssue && deleteMutation.mutate(deleteConfirmIssue.id)
            }
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Issue'}
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

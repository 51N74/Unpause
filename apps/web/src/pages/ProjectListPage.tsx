import React, { useState } from 'react';
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
  Grid,
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
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TimelineIcon from '@mui/icons-material/Timeline';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import EditIcon from '@mui/icons-material/Edit';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../api/endpoints';
import { extractApiError } from '../api/client';
import { ErrorState } from '../components/ErrorState';
import { ProjectStatusChip } from '../components/Badges';
import { EditProjectDialog } from '../components/EditProjectDialog';
import { formatBangkokDateTime } from '../utils/date';
import type { Project, ProjectStatus } from '../types/api';

const createProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(120, 'Project name must be at most 120 characters'),
  description: z
    .string()
    .trim()
    .max(2000, 'Description must be at most 2000 characters')
    .optional(),
  problem: z.string().trim().min(1, 'Initial scope problem is required'),
  targetUsers: z.string().trim().min(1, 'Target users is required'),
  goal: z.string().trim().min(1, 'Goal is required'),
  inScope: z.string().trim().min(1, 'In-scope items are required'),
  outOfScope: z.string().trim().min(1, 'Out-of-scope items are required'),
});

type CreateProjectFormValues = z.infer<typeof createProjectFormSchema>;

export const ProjectListPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'All'>('Active');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', { search: searchInput.trim(), status: statusFilter }],
    queryFn: () =>
      projectsApi.list({
        search: searchInput.trim() || undefined,
        status: statusFilter,
      }),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: {
      name: '',
      description: '',
      problem: '',
      targetUsers: '',
      goal: '',
      inScope: '',
      outOfScope: '',
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (values: CreateProjectFormValues) =>
      projectsApi.create({
        name: values.name,
        description: values.description ?? '',
        initialScope: {
          problem: values.problem,
          targetUsers: values.targetUsers,
          goal: values.goal,
          inScope: values.inScope,
          outOfScope: values.outOfScope,
        },
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreateDialogOpen(false);
      reset();
      // Navigate immediately to the new project's Resume Context
      navigate(`/projects/${data.project.id}/resume`);
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setCreateError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.archive(projectId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({
        queryKey: ['project', data.project.id],
      });
      setFeedbackMessage(`Archived "${data.project.name}".`);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.restore(projectId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({
        queryKey: ['project', data.project.id],
      });
      setFeedbackMessage(`Restored "${data.project.name}" to Active.`);
    },
  });

  const onSubmitCreate = (values: CreateProjectFormValues) => {
    setCreateError(null);
    createProjectMutation.mutate(values);
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
            Your Projects
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Select a project to view its Resume Context or Scope Timeline, or
            start a new project with Scope v1.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setCreateError(null);
            reset();
            setCreateDialogOpen(true);
          }}
        >
          New Project
        </Button>
      </Stack>

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
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            size="small"
            label="Search projects by name"
            placeholder="e.g., InvoiceFlow..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            fullWidth
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="project-status-filter-label">Status Filter</InputLabel>
            <Select
              labelId="project-status-filter-label"
              label="Status Filter"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as ProjectStatus | 'All')
              }
            >
              <MenuItem value="Active">Active Only</MenuItem>
              <MenuItem value="Archived">Archived Only</MenuItem>
              <MenuItem value="All">All Projects</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {projectsQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {projectsQuery.isError && (
        <ErrorState
          title="Failed to load projects"
          error={projectsQuery.error}
          onRetry={() => void projectsQuery.refetch()}
        />
      )}

      {!projectsQuery.isLoading &&
        !projectsQuery.isError &&
        projectsQuery.data && (
          <>
            {projectsQuery.data.projects.length === 0 ? (
              <Paper
                elevation={0}
                sx={{
                  p: 6,
                  textAlign: 'center',
                  border: '1px dashed',
                  borderColor: 'divider',
                  borderRadius: 2,
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                  No projects found
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  {searchInput.trim() || statusFilter !== 'Active'
                    ? 'No projects match your current search or status filter.'
                    : 'Create your first project and define its initial Scope Version 1 to begin tracking decisions and next actions.'}
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreateDialogOpen(true)}
                >
                  Create Your First Project
                </Button>
              </Paper>
            ) : (
              <Grid container spacing={2.5}>
                {projectsQuery.data.projects.map((project) => (
                  <Grid item xs={12} md={6} key={project.id}>
                    <Card
                      elevation={0}
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                      }}
                    >
                      <CardContent sx={{ flexGrow: 1 }}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="flex-start"
                          spacing={1}
                          sx={{ mb: 1 }}
                        >
                          <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            {project.name}
                          </Typography>
                          <Stack direction="row" spacing={1}>
                            <Chip
                              size="small"
                              label={`Scope v${project.currentScopeVersion}`}
                              color="primary"
                              variant="outlined"
                            />
                            <ProjectStatusChip status={project.status} />
                          </Stack>
                        </Stack>

                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mb: 2, minHeight: 36 }}
                        >
                          {project.description || 'No description provided.'}
                        </Typography>

                        {project.currentScope && (
                          <Box
                            sx={{
                              p: 1.5,
                              bgcolor: '#f8fafc',
                              borderRadius: 1,
                              border: '1px solid',
                              borderColor: 'divider',
                              mb: 1.5,
                            }}
                          >
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontWeight: 600, display: 'block' }}
                            >
                              Current Goal (Scope v{project.currentScope.versionNumber}):
                            </Typography>
                            <Typography variant="body2" noWrap>
                              {project.currentScope.goal}
                            </Typography>
                          </Box>
                        )}

                        <Typography variant="caption" color="text.secondary">
                          Last modified: {formatBangkokDateTime(project.updatedAt)}
                        </Typography>
                      </CardContent>
                      <Divider />
                      <CardActions
                        sx={{
                          px: 2,
                          py: 1.5,
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 1,
                        }}
                      >
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<PlayArrowIcon />}
                            component={RouterLink}
                            to={`/projects/${project.id}/resume`}
                          >
                            Resume Context
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<TimelineIcon />}
                            component={RouterLink}
                            to={`/projects/${project.id}/timeline`}
                          >
                            Timeline
                          </Button>
                        </Stack>

                        <Stack direction="row" spacing={1}>
                          {project.status === 'Active' ? (
                            <>
                              <Button
                                size="small"
                                color="inherit"
                                startIcon={<EditIcon />}
                                onClick={() => setEditingProject(project)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="small"
                                color="warning"
                                startIcon={<ArchiveIcon />}
                                disabled={archiveMutation.isPending}
                                onClick={() => archiveMutation.mutate(project.id)}
                              >
                                Archive
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="small"
                              color="success"
                              variant="outlined"
                              startIcon={<UnarchiveIcon />}
                              disabled={restoreMutation.isPending}
                              onClick={() => restoreMutation.mutate(project.id)}
                            >
                              Restore
                            </Button>
                          )}
                        </Stack>
                      </CardActions>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </>
        )}

      {/* Create Project + Initial Scope Version 1 Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <form onSubmit={handleSubmit(onSubmitCreate)} noValidate>
          <DialogTitle sx={{ fontWeight: 800 }}>
            Create Project & Initial Scope (Version 1)
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2.5}>
              <Alert severity="info">
                Creating a project also creates its immutable{' '}
                <strong>Scope Version 1</strong> (reason: &ldquo;Initial
                scope&rdquo;) in the same transaction, then opens your{' '}
                <strong>Resume Context</strong>.
              </Alert>

              {createError && <Alert severity="error">{createError}</Alert>}

              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                1. Project Details
              </Typography>

              <TextField
                label="Project Name *"
                placeholder="e.g., Unpause CLI, HabitLedger..."
                fullWidth
                {...register('name')}
                error={Boolean(errors.name)}
                helperText={errors.name?.message}
              />

              <TextField
                label="Project Description (Optional)"
                fullWidth
                multiline
                minRows={2}
                {...register('description')}
                error={Boolean(errors.description)}
                helperText={errors.description?.message}
              />

              <Divider />

              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                2. Initial Scope (Scope Version 1)
              </Typography>

              <TextField
                label="Problem *"
                placeholder="What specific problem does this project solve?"
                fullWidth
                multiline
                minRows={2}
                {...register('problem')}
                error={Boolean(errors.problem)}
                helperText={errors.problem?.message}
              />

              <TextField
                label="Target Users *"
                placeholder="Who is this project built for?"
                fullWidth
                {...register('targetUsers')}
                error={Boolean(errors.targetUsers)}
                helperText={errors.targetUsers?.message}
              />

              <TextField
                label="Goal *"
                placeholder="What is the concrete outcome of Version 1?"
                fullWidth
                multiline
                minRows={2}
                {...register('goal')}
                error={Boolean(errors.goal)}
                helperText={errors.goal?.message}
              />

              <TextField
                label="In-Scope Items *"
                placeholder="What features or workflows are explicitly included?"
                fullWidth
                multiline
                minRows={2}
                {...register('inScope')}
                error={Boolean(errors.inScope)}
                helperText={errors.inScope?.message}
              />

              <TextField
                label="Out-of-Scope Items *"
                placeholder="What are you deliberately NOT building right now?"
                fullWidth
                multiline
                minRows={2}
                {...register('outOfScope')}
                error={Boolean(errors.outOfScope)}
                helperText={errors.outOfScope?.message}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button
              onClick={() => setCreateDialogOpen(false)}
              disabled={createProjectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createProjectMutation.isPending}
            >
              {createProjectMutation.isPending
                ? 'Creating Project...'
                : 'Create Project & Open Resume Context'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {editingProject && (
        <EditProjectDialog
          open={Boolean(editingProject)}
          onClose={() => setEditingProject(null)}
          project={editingProject}
          onSuccess={() => setFeedbackMessage('Project details saved.')}
        />
      )}

      <Snackbar
        open={Boolean(feedbackMessage)}
        autoHideDuration={4000}
        onClose={() => setFeedbackMessage(null)}
        message={feedbackMessage}
      />
    </Box>
  );
};

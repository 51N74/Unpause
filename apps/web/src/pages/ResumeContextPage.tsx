import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import TimelineIcon from '@mui/icons-material/Timeline';
import AddIcon from '@mui/icons-material/Add';
import PushPinIcon from '@mui/icons-material/PushPin';
import GavelIcon from '@mui/icons-material/Gavel';
import AssignmentIcon from '@mui/icons-material/Assignment';
import EditIcon from '@mui/icons-material/Edit';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../api/endpoints';
import { ErrorState } from '../components/ErrorState';
import {
  IssuePriorityChip,
  IssueStatusChip,
  ScopeImpactChip,
} from '../components/Badges';
import { CreateScopeVersionDialog } from '../components/CreateScopeVersionDialog';
import { EditProjectDialog } from '../components/EditProjectDialog';
import { formatBangkokDateTime } from '../utils/date';

export const ResumeContextPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [newScopeDialogOpen, setNewScopeDialogOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const resumeQuery = useQuery({
    queryKey: ['project', projectId, 'resume-context'],
    queryFn: () => projectsApi.getResumeContext(projectId!),
    enabled: Boolean(projectId),
  });

  if (resumeQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (resumeQuery.isError || !resumeQuery.data) {
    return (
      <ErrorState
        title="Unable to load Resume Context"
        error={resumeQuery.error}
        onRetry={() => void resumeQuery.refetch()}
      />
    );
  }

  const {
    project,
    currentScope,
    pinnedDecisions,
    recentDecisions,
    outstandingIssues,
  } = resumeQuery.data;
  const isReadOnly = project.status === 'Archived';

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
            Resume Context
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Review saved project scope, pinned and recent decisions, and
            outstanding issues with their next actions.
          </Typography>
        </Box>

        {!isReadOnly && (
          <Stack direction="row" spacing={1.5} flexWrap="wrap">
            <Button
              variant="outlined"
              size="small"
              startIcon={<EditIcon />}
              onClick={() => setEditProjectOpen(true)}
            >
              Edit Project
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setNewScopeDialogOpen(true)}
            >
              New Scope Version
            </Button>
          </Stack>
        )}
      </Stack>

      {/* 1. Current Scope Section */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          bgcolor: '#ffffff',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1.5}
          sx={{ mb: 2 }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Chip
              color="primary"
              label={`Current Scope: Version ${currentScope.versionNumber}`}
              sx={{ fontWeight: 700 }}
            />
            <Typography variant="caption" color="text.secondary">
              Created: {formatBangkokDateTime(currentScope.createdAt)}
            </Typography>
          </Stack>

          <Button
            component={RouterLink}
            to={`/projects/${project.id}/timeline`}
            size="small"
            variant="outlined"
            startIcon={<TimelineIcon />}
            endIcon={<ArrowForwardIcon />}
          >
            View Full Scope Timeline
          </Button>
        </Stack>

        <Box
          sx={{
            p: 2,
            mb: 2.5,
            bgcolor: '#f1f5f9',
            borderRadius: 1.5,
            borderLeft: '4px solid',
            borderColor: 'primary.main',
          }}
        >
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}
          >
            Reason for Scope Version {currentScope.versionNumber}
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 600, mt: 0.5 }}>
            {currentScope.reasonForChange}
          </Typography>
        </Box>

        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              PROBLEM
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
              {currentScope.problem}
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              TARGET USERS
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
              {currentScope.targetUsers}
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              GOAL
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
              {currentScope.goal}
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Box
              sx={{
                p: 1.5,
                bgcolor: '#f8fafc',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                height: '100%',
              }}
            >
              <Typography variant="caption" color="success.main" sx={{ fontWeight: 700 }}>
                IN SCOPE
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                {currentScope.inScope}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <Box
              sx={{
                p: 1.5,
                bgcolor: '#f8fafc',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                height: '100%',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                OUT OF SCOPE
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                {currentScope.outOfScope}
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={3}>
        {/* 4. Outstanding Issues with Next Actions */}
        <Grid item xs={12} md={6}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              height: '100%',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <AssignmentIcon color="primary" fontSize="small" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Outstanding Issues (Up to 5)
                </Typography>
              </Stack>
              <Button
                component={RouterLink}
                to={`/projects/${project.id}/issues`}
                size="small"
                endIcon={<ArrowForwardIcon />}
              >
                All Issues
              </Button>
            </Stack>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Open & In Progress issues ordered by priority (High → Medium → Low) then last modified.
            </Typography>

            {outstandingIssues.length === 0 ? (
              <Box
                sx={{
                  p: 3,
                  textAlign: 'center',
                  bgcolor: '#f8fafc',
                  borderRadius: 1.5,
                  border: '1px dashed',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  No open or in-progress issues right now.
                </Typography>
                <Button
                  component={RouterLink}
                  to={`/projects/${project.id}/issues`}
                  size="small"
                  variant="outlined"
                >
                  Go to Issues
                </Button>
              </Box>
            ) : (
              <Stack spacing={2}>
                {outstandingIssues.map((issue) => (
                  <Card
                    key={issue.id}
                    variant="outlined"
                    sx={{ borderRadius: 1.5 }}
                  >
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="flex-start"
                        spacing={1}
                        sx={{ mb: 1 }}
                      >
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {issue.title}
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexShrink={0}>
                          <IssuePriorityChip priority={issue.priority} />
                          <IssueStatusChip status={issue.status} />
                        </Stack>
                      </Stack>

                      <Box
                        sx={{
                          p: 1.25,
                          bgcolor: '#eff6ff',
                          borderRadius: 1,
                          borderLeft: '3px solid',
                          borderColor: 'primary.main',
                          mb: 1,
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, color: 'primary.dark', display: 'block' }}
                        >
                          NEXT ACTION
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {issue.nextAction}
                        </Typography>
                      </Box>

                      <Typography variant="caption" color="text.secondary">
                        Modified: {formatBangkokDateTime(issue.updatedAt)}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>

        {/* 2. Pinned Decisions & 3. Recent Decisions under Current Scope */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* 2. Pinned Decisions (Up to 3) */}
            <Paper
              elevation={0}
              sx={{
                p: 3,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 2 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <PushPinIcon color="secondary" fontSize="small" />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Pinned Decisions (Up to 3)
                  </Typography>
                </Stack>
                <Button
                  component={RouterLink}
                  to={`/projects/${project.id}/decisions`}
                  size="small"
                  endIcon={<ArrowForwardIcon />}
                >
                  All Decisions
                </Button>
              </Stack>

              {pinnedDecisions.length === 0 ? (
                <Box
                  sx={{
                    p: 2.5,
                    textAlign: 'center',
                    bgcolor: '#f8fafc',
                    borderRadius: 1.5,
                    border: '1px dashed',
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No pinned decisions yet. Pin key architectural or scope
                    decisions to keep them visible here.
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={1.5}>
                  {pinnedDecisions.map((dec) => (
                    <Card key={dec.id} variant="outlined" sx={{ borderRadius: 1.5 }}>
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          flexWrap="wrap"
                          sx={{ mb: 1 }}
                        >
                          <Chip
                            size="small"
                            color="primary"
                            variant="outlined"
                            label={`Scope v${dec.scopeVersion?.versionNumber ?? '?'}`}
                          />
                          <ScopeImpactChip impact={dec.scopeImpact} />
                        </Stack>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {dec.decision}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                        >
                          <strong>Rationale:</strong> {dec.rationale}
                        </Typography>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              )}
            </Paper>

            {/* 3. Recent Decisions under Current Scope (Up to 5) */}
            <Paper
              elevation={0}
              sx={{
                p: 3,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 2 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <GavelIcon color="primary" fontSize="small" />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Latest Decisions in Scope v{currentScope.versionNumber} (Up to 5)
                  </Typography>
                </Stack>
                <Button
                  component={RouterLink}
                  to={`/projects/${project.id}/decisions`}
                  size="small"
                >
                  Manage
                </Button>
              </Stack>

              {recentDecisions.length === 0 ? (
                <Box
                  sx={{
                    p: 2.5,
                    textAlign: 'center',
                    bgcolor: '#f8fafc',
                    borderRadius: 1.5,
                    border: '1px dashed',
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    No decisions have been recorded under Scope Version{' '}
                    {currentScope.versionNumber} yet.
                  </Typography>
                  <Button
                    component={RouterLink}
                    to={`/projects/${project.id}/decisions`}
                    size="small"
                    variant="outlined"
                  >
                    Record a Decision
                  </Button>
                </Box>
              ) : (
                <Stack spacing={1.5} divider={<Divider />}>
                  {recentDecisions.map((dec) => (
                    <Box key={dec.id}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        spacing={1}
                        sx={{ mb: 0.5 }}
                      >
                        <ScopeImpactChip impact={dec.scopeImpact} />
                        <Typography variant="caption" color="text.secondary">
                          {formatBangkokDateTime(dec.createdAt)}
                        </Typography>
                      </Stack>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {dec.decision}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Problem:</strong> {dec.problem}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Rationale:</strong> {dec.rationale}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>
          </Stack>
        </Grid>
      </Grid>

      <CreateScopeVersionDialog
        open={newScopeDialogOpen}
        onClose={() => setNewScopeDialogOpen(false)}
        projectId={project.id}
        prefillScope={currentScope}
        onCreated={(newVersion) =>
          setFeedback(
            `Created Scope Version ${newVersion.versionNumber} as current scope.`
          )
        }
      />

      <EditProjectDialog
        open={editProjectOpen}
        onClose={() => setEditProjectOpen(false)}
        project={project}
        onSuccess={() => setFeedback('Project details updated.')}
      />

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={4000}
        onClose={() => setFeedback(null)}
        message={feedback}
      />
    </Box>
  );
};

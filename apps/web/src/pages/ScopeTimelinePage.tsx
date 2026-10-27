import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import GavelIcon from '@mui/icons-material/Gavel';
import PushPinIcon from '@mui/icons-material/PushPin';
import LinkIcon from '@mui/icons-material/Link';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../api/endpoints';
import { ErrorState } from '../components/ErrorState';
import { ScopeImpactChip } from '../components/Badges';
import { CreateScopeVersionDialog } from '../components/CreateScopeVersionDialog';
import { formatBangkokDateTime } from '../utils/date';
import type { ScopeVersion } from '../types/api';

export const ScopeTimelinePage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [prefillScope, setPrefillScope] = useState<ScopeVersion | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const timelineQuery = useQuery({
    queryKey: ['project', projectId, 'timeline'],
    queryFn: () => projectsApi.getTimeline(projectId!),
    enabled: Boolean(projectId),
  });

  if (timelineQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (timelineQuery.isError || !timelineQuery.data) {
    return (
      <ErrorState
        title="Unable to load Scope Timeline"
        error={timelineQuery.error}
        onRetry={() => void timelineQuery.refetch()}
      />
    );
  }

  const { project, versions } = timelineQuery.data;
  const isReadOnly = project.status === 'Archived';
  const latestScope =
    versions.length > 0 ? versions[versions.length - 1] : null;

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
            Scope Timeline
          </Typography>
          <Typography variant="body2" color="text.secondary">
            See how the project scope evolved from Version 1 onward, why each
            change was made, and which decisions were recorded under each scope
            version.
          </Typography>
        </Box>

        {!isReadOnly && latestScope && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setPrefillScope(latestScope);
              setDialogOpen(true);
            }}
          >
            Create New Scope Version
          </Button>
        )}
      </Stack>

      <Stack spacing={4}>
        {versions.map((sv) => (
          <Paper
            key={sv.id}
            elevation={0}
            sx={{
              p: 3,
              border: '2px solid',
              borderColor: sv.isCurrent ? 'primary.main' : 'divider',
              borderRadius: 2,
              bgcolor: '#ffffff',
            }}
          >
            {/* Scope Version Header */}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={1.5}
              sx={{ mb: 2 }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                <Chip
                  label={`Scope Version ${sv.versionNumber}`}
                  color={sv.isCurrent ? 'primary' : 'default'}
                  sx={{ fontWeight: 700 }}
                />
                {sv.isCurrent && (
                  <Chip
                    label="Current Active Scope"
                    color="success"
                    size="small"
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                )}
                <Typography variant="caption" color="text.secondary">
                  Created: {formatBangkokDateTime(sv.createdAt)}
                </Typography>
              </Stack>

              {!isReadOnly && !sv.isCurrent && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<HistoryIcon />}
                  onClick={() => {
                    setPrefillScope(sv);
                    setDialogOpen(true);
                  }}
                >
                  Use v{sv.versionNumber} as Template for New Version
                </Button>
              )}
            </Stack>

            {/* Reason for Version */}
            <Box
              sx={{
                p: 2,
                mb: 2.5,
                bgcolor: sv.isCurrent ? '#eff6ff' : '#f8fafc',
                borderRadius: 1.5,
                borderLeft: '4px solid',
                borderColor: sv.isCurrent ? 'primary.main' : 'grey.400',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                }}
              >
                Reason for Version {sv.versionNumber}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 600, mt: 0.5 }}>
                {sv.reasonForChange}
              </Typography>
            </Box>

            {/* Scope Snapshot Details */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={4}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 700 }}
                >
                  PROBLEM
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                  {sv.problem}
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 700 }}
                >
                  TARGET USERS
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                  {sv.targetUsers}
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 700 }}
                >
                  GOAL
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                  {sv.goal}
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
                  }}
                >
                  <Typography
                    variant="caption"
                    color="success.main"
                    sx={{ fontWeight: 700 }}
                  >
                    IN SCOPE
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                    {sv.inScope}
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
                  }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontWeight: 700 }}
                  >
                    OUT OF SCOPE
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
                    {sv.outOfScope}
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            {/* Decisions Recorded Under This Scope Version */}
            <Box
              sx={{
                pt: 2,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 2 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <GavelIcon fontSize="small" color="action" />
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Decisions Made Under Scope Version {sv.versionNumber} (
                    {sv.decisions.length})
                  </Typography>
                </Stack>
                {sv.isCurrent && !isReadOnly && (
                  <Button
                    component={RouterLink}
                    to={`/projects/${project.id}/decisions`}
                    size="small"
                    variant="outlined"
                  >
                    Record Decision in v{sv.versionNumber}
                  </Button>
                )}
              </Stack>

              {sv.decisions.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontStyle: 'italic' }}
                >
                  No decision records were logged while Scope Version{' '}
                  {sv.versionNumber} was active.
                </Typography>
              ) : (
                <Stack spacing={2}>
                  {sv.decisions.map((dec) => (
                    <Card
                      key={dec.id}
                      variant="outlined"
                      sx={{
                        borderRadius: 1.5,
                        bgcolor: '#fcfcfd',
                      }}
                    >
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          justifyContent="space-between"
                          alignItems={{ xs: 'flex-start', sm: 'center' }}
                          spacing={1}
                          sx={{ mb: 1 }}
                        >
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            flexWrap="wrap"
                          >
                            <ScopeImpactChip impact={dec.scopeImpact} />
                            {dec.isPinned && (
                              <Chip
                                size="small"
                                icon={<PushPinIcon />}
                                label="Pinned"
                                color="secondary"
                                variant="outlined"
                              />
                            )}
                            {dec.issue && (
                              <Chip
                                size="small"
                                icon={<LinkIcon />}
                                label={`Issue: ${dec.issue.title}`}
                                variant="outlined"
                              />
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            Recorded: {formatBangkokDateTime(dec.createdAt)}
                          </Typography>
                        </Stack>

                        <Typography
                          variant="subtitle1"
                          sx={{ fontWeight: 700, mb: 0.5 }}
                        >
                          Decision: {dec.decision}
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                          <strong>Problem:</strong> {dec.problem}
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                          <strong>Rationale:</strong> {dec.rationale}
                        </Typography>
                        {dec.alternativesConsidered && (
                          <Typography variant="body2" color="text.secondary">
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
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          </Paper>
        ))}
      </Stack>

      <CreateScopeVersionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        projectId={project.id}
        prefillScope={prefillScope}
        onCreated={(newVersion) =>
          setFeedback(
            `Created immutable Scope Version ${newVersion.versionNumber}.`
          )
        }
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

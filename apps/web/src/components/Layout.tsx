import React from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from '@mui/material';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ExploreIcon from '@mui/icons-material/Explore';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import TimelineIcon from '@mui/icons-material/Timeline';
import AssignmentIcon from '@mui/icons-material/Assignment';
import GavelIcon from '@mui/icons-material/Gavel';
import DashboardIcon from '@mui/icons-material/Dashboard';
import {
  Link as RouterLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { projectsApi } from '../api/endpoints';
import { ProjectStatusChip } from './Badges';
import { formatBangkokDateTime } from '../utils/date';

export const AppLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams<{ projectId?: string }>();
  const queryClient = useQueryClient();

  const projectQuery = useQuery({
    queryKey: ['project', projectId, 'header'],
    queryFn: () => projectsApi.getById(projectId!),
    enabled: Boolean(projectId),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => projectsApi.restore(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const currentProject = projectQuery.data?.project;

  const getActiveProjectTab = () => {
    if (!projectId) return false;
    if (location.pathname.endsWith('/timeline')) return 'timeline';
    if (location.pathname.endsWith('/issues')) return 'issues';
    if (location.pathname.endsWith('/decisions')) return 'decisions';
    return 'resume';
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#f8fafc' }}>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          bgcolor: '#ffffff',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', py: 0.5 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                component={RouterLink}
                to="/projects"
                startIcon={<PlayCircleOutlineIcon color="primary" />}
                sx={{
                  fontWeight: 800,
                  fontSize: '1.15rem',
                  color: 'text.primary',
                  textTransform: 'none',
                }}
              >
                Unpause
              </Button>
              <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
              <Button
                component={RouterLink}
                to="/projects"
                startIcon={<FolderOpenIcon />}
                color={
                  location.pathname.startsWith('/projects') ? 'primary' : 'inherit'
                }
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Projects
              </Button>
              <Button
                component={RouterLink}
                to="/github"
                startIcon={<ExploreIcon />}
                color={
                  location.pathname.startsWith('/github') ? 'primary' : 'inherit'
                }
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                GitHub Explorer
              </Button>
            </Stack>

            <Stack direction="row" spacing={1.5} alignItems="center">
              {user && (
                <Chip
                  label={user.displayName}
                  size="small"
                  variant="outlined"
                  sx={{ fontWeight: 500, display: { xs: 'none', sm: 'inline-flex' } }}
                />
              )}
              <Button
                component={RouterLink}
                to="/settings"
                size="small"
                startIcon={<SettingsIcon />}
                color={
                  location.pathname.startsWith('/settings') ? 'primary' : 'inherit'
                }
                sx={{ textTransform: 'none' }}
              >
                Settings
              </Button>
              <Button
                onClick={handleLogout}
                size="small"
                color="inherit"
                startIcon={<LogoutIcon />}
                sx={{ textTransform: 'none' }}
              >
                Logout
              </Button>
            </Stack>
          </Toolbar>
        </Container>
      </AppBar>

      {projectId && currentProject && (
        <Paper
          elevation={0}
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: '#ffffff',
          }}
        >
          <Container maxWidth="lg">
            <Box sx={{ pt: 2, pb: 1 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={1}
              >
                <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {currentProject.name}
                  </Typography>
                  <ProjectStatusChip status={currentProject.status} />
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`Current Scope: v${currentProject.currentScopeVersion}`}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Last modified: {formatBangkokDateTime(currentProject.updatedAt)}
                </Typography>
              </Stack>

              {currentProject.status === 'Archived' && (
                <Alert
                  severity="warning"
                  sx={{ mt: 1.5 }}
                  action={
                    <Button
                      color="warning"
                      size="small"
                      variant="outlined"
                      disabled={restoreMutation.isPending}
                      onClick={() => restoreMutation.mutate(currentProject.id)}
                    >
                      {restoreMutation.isPending ? 'Restoring...' : 'Restore Project'}
                    </Button>
                  }
                >
                  This project is <strong>Archived</strong> and read-only. Its scope
                  history, decisions, and issues cannot be modified unless restored.
                </Alert>
              )}
            </Box>

            <Tabs
              value={getActiveProjectTab()}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ minHeight: 44 }}
            >
              <Tab
                value="resume"
                label="Resume Context"
                icon={<DashboardIcon fontSize="small" />}
                iconPosition="start"
                component={RouterLink}
                to={`/projects/${projectId}/resume`}
                sx={{ textTransform: 'none', fontWeight: 600, minHeight: 44 }}
              />
              <Tab
                value="timeline"
                label="Scope Timeline"
                icon={<TimelineIcon fontSize="small" />}
                iconPosition="start"
                component={RouterLink}
                to={`/projects/${projectId}/timeline`}
                sx={{ textTransform: 'none', fontWeight: 600, minHeight: 44 }}
              />
              <Tab
                value="decisions"
                label="Decision Records"
                icon={<GavelIcon fontSize="small" />}
                iconPosition="start"
                component={RouterLink}
                to={`/projects/${projectId}/decisions`}
                sx={{ textTransform: 'none', fontWeight: 600, minHeight: 44 }}
              />
              <Tab
                value="issues"
                label="Issues"
                icon={<AssignmentIcon fontSize="small" />}
                iconPosition="start"
                component={RouterLink}
                to={`/projects/${projectId}/issues`}
                sx={{ textTransform: 'none', fontWeight: 600, minHeight: 44 }}
              />
            </Tabs>
          </Container>
        </Paper>
      )}

      <Container maxWidth="lg" sx={{ py: 3, flexGrow: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
};

import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProjectListPage } from './pages/ProjectListPage';
import { ResumeContextPage } from './pages/ResumeContextPage';
import { ScopeTimelinePage } from './pages/ScopeTimelinePage';
import { IssuesPage } from './pages/IssuesPage';
import { DecisionsPage } from './pages/DecisionsPage';
import { GitHubExplorerPage } from './pages/GitHubExplorerPage';
import { SettingsPage } from './pages/SettingsPage';

const ProtectedRoute: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

const GuestOnlyRoute: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (user) {
    return <Navigate to="/projects" replace />;
  }

  return <Outlet />;
};

export const App: React.FC = () => {
  return (
    <Routes>
      <Route element={<GuestOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/projects" element={<ProjectListPage />} />
          <Route
            path="/projects/:projectId"
            element={<Navigate to="resume" replace />}
          />
          <Route
            path="/projects/:projectId/resume"
            element={<ResumeContextPage />}
          />
          <Route
            path="/projects/:projectId/timeline"
            element={<ScopeTimelinePage />}
          />
          <Route path="/projects/:projectId/issues" element={<IssuesPage />} />
          <Route
            path="/projects/:projectId/decisions"
            element={<DecisionsPage />}
          />
          <Route path="/github" element={<GitHubExplorerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
};

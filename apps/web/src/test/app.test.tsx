import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { formatBangkokDateTime } from '../utils/date';
import { ErrorState } from '../components/ErrorState';
import { ScopeImpactChip } from '../components/Badges';
import { AuthProvider } from '../context/AuthContext';
import { App } from '../App';
import { apiClient } from '../api/client';
import { authApi, projectsApi } from '../api/endpoints';

describe('Unpause Web Utilities & Components', () => {
  it('formats UTC timestamps into Asia/Bangkok (UTC+7)', () => {
    // 2026-10-19T10:30:00.000Z in UTC is 17:30 in Asia/Bangkok
    const formatted = formatBangkokDateTime('2026-10-19T10:30:00.000Z');
    expect(formatted).toContain('17:30');
    expect(formatted).toContain('Asia/Bangkok');
  });

  it('renders ErrorState with error message, Error ID, and Retry button', () => {
    const onRetry = vi.fn();
    const fakeAxiosError = {
      isAxiosError: true,
      response: {
        status: 429,
        data: {
          error: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            code: 'GITHUB_RATE_LIMIT',
            message: 'GitHub API rate limit reached.',
          },
        },
      },
    };

    render(
      <ErrorState
        title="GitHub API Request Failed"
        error={fakeAxiosError}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('GitHub API Request Failed')).toBeInTheDocument();
    expect(
      screen.getByText('GitHub API rate limit reached.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/123e4567-e89b-12d3-a456-426614174000/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders ScopeImpactChip with exact user-selected impact label', () => {
    render(<ScopeImpactChip impact="Changes direction" />);
    expect(
      screen.getByText('Impact: Changes direction')
    ).toBeInTheDocument();
  });

  it('redirects cleanly to /login when a protected endpoint returns 401 UNAUTHORIZED without redirect loops', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Seed cached user as if logged in
    queryClient.setQueryData(['auth', 'me'], {
      user: {
        id: 'user-1',
        email: 'dev@unpause.local',
        displayName: 'Solo Dev',
        createdAt: '2026-10-27T00:00:00.000Z',
        updatedAt: '2026-10-27T00:00:00.000Z',
      },
    });

    const meSpy = vi.spyOn(authApi, 'me').mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'dev@unpause.local',
        displayName: 'Solo Dev',
        createdAt: '2026-10-27T00:00:00.000Z',
        updatedAt: '2026-10-27T00:00:00.000Z',
      },
    });

    const listSpy = vi.spyOn(projectsApi, 'list').mockImplementation(async () => {
      await Promise.resolve();
      // Trigger the Axios response interceptor with a 401 error
      const rejectedHandler = (
        apiClient.interceptors.response as unknown as {
          handlers: Array<{ rejected: (err: unknown) => Promise<never> }>;
        }
      ).handlers[0].rejected;

      const unauthorizedErr = {
        isAxiosError: true,
        config: { url: '/projects' },
        response: {
          status: 401,
          data: {
            error: {
              id: 'ab8d746d-7791-42ce-aedd-c7781d2dcaa9',
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            },
          },
        },
      };

      return rejectedHandler(unauthorizedErr);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/projects']}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Sign in to Unpause')).toBeInTheDocument();
    });

    meSpy.mockRestore();
    listSpy.mockRestore();
  });
});

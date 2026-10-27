import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatBangkokDateTime } from '../utils/date';
import { ErrorState } from '../components/ErrorState';
import { ScopeImpactChip } from '../components/Badges';

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
});

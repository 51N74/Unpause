import React from 'react';
import { Chip } from '@mui/material';
import type {
  IssuePriority,
  IssueStatus,
  ProjectStatus,
  ScopeImpact,
} from '../types/api';

export const ProjectStatusChip: React.FC<{ status: ProjectStatus }> = ({
  status,
}) => (
  <Chip
    size="small"
    label={status}
    color={status === 'Active' ? 'success' : 'default'}
    variant={status === 'Active' ? 'filled' : 'outlined'}
    sx={{ fontWeight: 600 }}
  />
);

export const IssueStatusChip: React.FC<{ status: IssueStatus }> = ({
  status,
}) => {
  const colorMap: Record<
    IssueStatus,
    'info' | 'warning' | 'success'
  > = {
    Open: 'info',
    'In Progress': 'warning',
    Closed: 'success',
  };

  return (
    <Chip
      size="small"
      label={status}
      color={colorMap[status]}
      variant="outlined"
      sx={{ fontWeight: 600 }}
    />
  );
};

export const IssuePriorityChip: React.FC<{ priority: IssuePriority }> = ({
  priority,
}) => {
  const colorMap: Record<
    IssuePriority,
    'error' | 'warning' | 'default'
  > = {
    High: 'error',
    Medium: 'warning',
    Low: 'default',
  };

  return (
    <Chip
      size="small"
      label={`Priority: ${priority}`}
      color={colorMap[priority]}
      sx={{ fontWeight: 500 }}
    />
  );
};

export const ScopeImpactChip: React.FC<{ impact: ScopeImpact }> = ({
  impact,
}) => {
  const colorMap: Record<
    ScopeImpact,
    'default' | 'primary' | 'secondary' | 'warning'
  > = {
    None: 'default',
    Expands: 'primary',
    Narrows: 'secondary',
    'Changes direction': 'warning',
  };

  return (
    <Chip
      size="small"
      label={`Impact: ${impact}`}
      color={colorMap[impact]}
      variant="outlined"
      sx={{ fontWeight: 600 }}
    />
  );
};

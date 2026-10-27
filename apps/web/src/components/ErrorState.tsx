import React from 'react';
import { Alert, AlertTitle, Box, Button, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { extractApiError } from '../api/client';

interface ErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Unable to load data',
  error,
  onRetry,
}) => {
  const parsed = extractApiError(error);

  return (
    <Box sx={{ my: 2 }}>
      <Alert
        severity="error"
        variant="outlined"
        action={
          onRetry ? (
            <Button
              color="error"
              size="small"
               variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={onRetry}
            >
              Retry
            </Button>
          ) : undefined
        }
      >
        <AlertTitle sx={{ fontWeight: 600 }}>{title}</AlertTitle>
        <Typography variant="body2">{parsed.message}</Typography>
        {parsed.id && (
          <Typography
            variant="caption"
            sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}
          >
            Error ID: {parsed.id} ({parsed.code})
          </Typography>
        )}
      </Alert>
    </Box>
  );
};

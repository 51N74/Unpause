import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/endpoints';
import { extractApiError } from '../api/client';
import { formatBangkokDateTime } from '../utils/date';

const settingsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required')
    .max(80, 'Display name must be at most 80 characters'),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
    },
  });

  useEffect(() => {
    if (user) {
      reset({ displayName: user.displayName });
    }
  }, [user, reset]);

  const updateMutation = useMutation({
    mutationFn: (values: SettingsFormValues) =>
      authApi.updateDisplayName(values.displayName),
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], data);
      reset({ displayName: data.user.displayName });
      setSaveSuccess(true);
      setSaveError(null);
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setSaveError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
      setSaveSuccess(false);
    },
  });

  const onSubmit = (values: SettingsFormValues) => {
    if (!user || values.displayName.trim() === user.displayName) {
      return;
    }
    setSaveSuccess(false);
    setSaveError(null);
    updateMutation.mutate(values);
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto' }}>
      <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
        Account Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage your display name for your Unpause workspace.
      </Typography>

      <Paper
        elevation={0}
        sx={{
          p: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Stack spacing={2.5}>
            {saveSuccess && (
              <Alert severity="success" onClose={() => setSaveSuccess(false)}>
                Display name updated.
              </Alert>
            )}
            {saveError && <Alert severity="error">{saveError}</Alert>}

            <TextField
              label="Email Address"
              value={user?.email ?? ''}
              disabled
              fullWidth
              helperText="Account email address (read-only)"
            />

            <TextField
              label="Display Name *"
              fullWidth
              {...register('displayName')}
              error={Boolean(errors.displayName)}
              helperText={errors.displayName?.message}
            />

            {user && (
              <Typography variant="caption" color="text.secondary">
                Account created: {formatBangkokDateTime(user.createdAt)}
              </Typography>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="submit"
                variant="contained"
                disabled={!isDirty || updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Display Name'}
              </Button>
            </Box>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
};

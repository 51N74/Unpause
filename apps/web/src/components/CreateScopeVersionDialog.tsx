import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { scopeVersionsApi } from '../api/endpoints';
import { extractApiError } from '../api/client';
import type { ScopeVersion } from '../types/api';

const newScopeSchema = z.object({
  problem: z.string().trim().min(1, 'Problem is required'),
  targetUsers: z.string().trim().min(1, 'Target users is required'),
  goal: z.string().trim().min(1, 'Goal is required'),
  inScope: z.string().trim().min(1, 'In-scope items are required'),
  outOfScope: z.string().trim().min(1, 'Out-of-scope items are required'),
  reasonForChange: z
    .string()
    .trim()
    .min(1, 'Reason for change is required when creating a new scope version'),
});

type NewScopeFormValues = z.infer<typeof newScopeSchema>;

interface CreateScopeVersionDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  prefillScope: ScopeVersion | null;
  onCreated?: (newVersion: ScopeVersion) => void;
}

export const CreateScopeVersionDialog: React.FC<
  CreateScopeVersionDialogProps
> = ({ open, onClose, projectId, prefillScope, onCreated }) => {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewScopeFormValues>({
    resolver: zodResolver(newScopeSchema),
    defaultValues: {
      problem: prefillScope?.problem ?? '',
      targetUsers: prefillScope?.targetUsers ?? '',
      goal: prefillScope?.goal ?? '',
      inScope: prefillScope?.inScope ?? '',
      outOfScope: prefillScope?.outOfScope ?? '',
      reasonForChange: '',
    },
  });

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      reset({
        problem: prefillScope?.problem ?? '',
        targetUsers: prefillScope?.targetUsers ?? '',
        goal: prefillScope?.goal ?? '',
        inScope: prefillScope?.inScope ?? '',
        outOfScope: prefillScope?.outOfScope ?? '',
        reasonForChange: '',
      });
    }
  }, [open, prefillScope, reset]);

  const createMutation = useMutation({
    mutationFn: (values: NewScopeFormValues) =>
      scopeVersionsApi.create(projectId, values),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ['project', projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['projects'],
      });
      onCreated?.(data.scopeVersion);
      onClose();
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setSubmitError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
    },
  });

  const onSubmit = (values: NewScopeFormValues) => {
    setSubmitError(null);
    createMutation.mutate(values);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <DialogTitle sx={{ fontWeight: 700 }}>
          Create New Immutable Scope Version
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Alert severity="info">
              Scope versions are immutable. Creating a new version preserves all
              previous versions and links future Decision Records to this new
              version. Fields are prefilled from{' '}
              {prefillScope
                ? `Scope v${prefillScope.versionNumber}`
                : 'the current scope'}
              .
            </Alert>

            {submitError && <Alert severity="error">{submitError}</Alert>}

            <TextField
              label="Reason for Change *"
              placeholder="Explain why the project scope is evolving or being corrected..."
              fullWidth
              multiline
              minRows={2}
              {...register('reasonForChange')}
              error={Boolean(errors.reasonForChange)}
              helperText={
                errors.reasonForChange?.message ||
                'Required: explain what triggered this scope change'
              }
            />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, pt: 1 }}>
              Scope Definition
            </Typography>

            <TextField
              label="Problem *"
              fullWidth
              multiline
              minRows={2}
              {...register('problem')}
              error={Boolean(errors.problem)}
              helperText={errors.problem?.message}
            />

            <TextField
              label="Target Users *"
              fullWidth
              {...register('targetUsers')}
              error={Boolean(errors.targetUsers)}
              helperText={errors.targetUsers?.message}
            />

            <TextField
              label="Goal *"
              fullWidth
              multiline
              minRows={2}
              {...register('goal')}
              error={Boolean(errors.goal)}
              helperText={errors.goal?.message}
            />

            <TextField
              label="In-Scope Items *"
              fullWidth
              multiline
              minRows={2}
              {...register('inScope')}
              error={Boolean(errors.inScope)}
              helperText={errors.inScope?.message}
            />

            <TextField
              label="Out-of-Scope Items *"
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
          <Button onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? 'Saving New Version...'
              : 'Save New Scope Version'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

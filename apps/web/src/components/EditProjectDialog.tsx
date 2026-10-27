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
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../api/endpoints';
import { extractApiError } from '../api/client';
import type { Project } from '../types/api';

const editProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(120, 'Project name must be at most 120 characters'),
  description: z
    .string()
    .trim()
    .max(2000, 'Description must be at most 2000 characters'),
});

type EditProjectValues = z.infer<typeof editProjectSchema>;

interface EditProjectDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onSuccess?: () => void;
}

export const EditProjectDialog: React.FC<EditProjectDialogProps> = ({
  open,
  onClose,
  project,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<EditProjectValues>({
    resolver: zodResolver(editProjectSchema),
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
    },
  });

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      reset({
        name: project.name,
        description: project.description ?? '',
      });
    }
  }, [open, project, reset]);

  const updateMutation = useMutation({
    mutationFn: (values: EditProjectValues) =>
      projectsApi.update(project.id, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setSubmitError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
    },
  });

  const onSubmit = (values: EditProjectValues) => {
    if (
      values.name.trim() === project.name &&
      values.description.trim() === (project.description ?? '')
    ) {
      onClose();
      return;
    }
    setSubmitError(null);
    updateMutation.mutate(values);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit Project Details</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <TextField
              label="Project Name *"
              fullWidth
              {...register('name')}
              error={Boolean(errors.name)}
              helperText={errors.name?.message}
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={3}
              {...register('description')}
              error={Boolean(errors.description)}
              helperText={errors.description?.message}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!isDirty || updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

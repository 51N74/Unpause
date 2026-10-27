import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/endpoints';
import { extractApiError } from '../api/client';

const registerFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required')
    .max(80, 'Display name must be at most 80 characters'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

type RegisterFormValues = z.infer<typeof registerFormSchema>;

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
    },
  });

  const registerMutation = useMutation({
    mutationFn: (values: RegisterFormValues) => authApi.register(values),
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], data);
      navigate('/projects', { replace: true });
    },
    onError: (err) => {
      const parsed = extractApiError(err);
      setSubmitError(
        parsed.id ? `${parsed.message} (ID: ${parsed.id})` : parsed.message
      );
    },
  });

  const onSubmit = (values: RegisterFormValues) => {
    setSubmitError(null);
    registerMutation.mutate(values);
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        bgcolor: '#f8fafc',
        py: 6,
      }}
    >
      <Container maxWidth="xs">
        <Paper
          elevation={0}
          sx={{
            p: 4,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Stack spacing={3}>
            <Stack spacing={1} alignItems="center" textAlign="center">
              <PlayCircleOutlineIcon color="primary" sx={{ fontSize: 40 }} />
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                Create your Unpause account
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Track project scope versions, decisions, and next actions in one
                place.
              </Typography>
            </Stack>

            {submitError && <Alert severity="error">{submitError}</Alert>}

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <Stack spacing={2.5}>
                <TextField
                  label="Display Name *"
                  autoComplete="name"
                  fullWidth
                  {...register('displayName')}
                  error={Boolean(errors.displayName)}
                  helperText={errors.displayName?.message}
                />

                <TextField
                  label="Email Address *"
                  type="email"
                  autoComplete="email"
                  fullWidth
                  {...register('email')}
                  error={Boolean(errors.email)}
                  helperText={errors.email?.message}
                />

                <TextField
                  label="Password *"
                  type="password"
                  autoComplete="new-password"
                  fullWidth
                  {...register('password')}
                  error={Boolean(errors.password)}
                  helperText={
                    errors.password?.message || 'At least 8 characters'
                  }
                />

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={registerMutation.isPending}
                >
                  {registerMutation.isPending
                    ? 'Creating Account...'
                    : 'Create Account'}
                </Button>
              </Stack>
            </form>

            <Typography variant="body2" textAlign="center" color="text.secondary">
              Already have an account?{' '}
              <Link
                component={RouterLink}
                to="/login"
                underline="hover"
                sx={{ fontWeight: 600 }}
              >
                Sign in
              </Link>
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
};

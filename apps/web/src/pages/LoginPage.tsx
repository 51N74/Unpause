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

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const loginMutation = useMutation({
    mutationFn: (values: LoginFormValues) => authApi.login(values),
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

  const onSubmit = (values: LoginFormValues) => {
    setSubmitError(null);
    loginMutation.mutate(values);
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
                Sign in to Unpause
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Resume your solo projects with clear scope history and decision
                context.
              </Typography>
            </Stack>

            {submitError && <Alert severity="error">{submitError}</Alert>}

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <Stack spacing={2.5}>
                <TextField
                  label="Email Address"
                  type="email"
                  autoComplete="email"
                  fullWidth
                  {...register('email')}
                  error={Boolean(errors.email)}
                  helperText={errors.email?.message}
                />

                <TextField
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  fullWidth
                  {...register('password')}
                  error={Boolean(errors.password)}
                  helperText={errors.password?.message}
                />

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? 'Signing In...' : 'Sign In'}
                </Button>
              </Stack>
            </form>

            <Typography variant="body2" textAlign="center" color="text.secondary">
              Don&apos;t have an account?{' '}
              <Link
                component={RouterLink}
                to="/register"
                underline="hover"
                sx={{ fontWeight: 600 }}
              >
                Create an account
              </Link>
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
};

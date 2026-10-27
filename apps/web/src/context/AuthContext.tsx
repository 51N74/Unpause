import React, { createContext, useContext, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onUnauthorizedResponse } from '../api/client';
import { authApi } from '../api/endpoints';
import type { User } from '../types/api';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isError: boolean;
  refetchUser: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return onUnauthorizedResponse(() => {
      const currentAuth = queryClient.getQueryData<{ user: User } | null>([
        'auth',
        'me',
      ]);
      if (currentAuth?.user) {
        queryClient.setQueryData(['auth', 'me'], null);
        queryClient.removeQueries({
          predicate: (query) =>
            !(query.queryKey[0] === 'auth' && query.queryKey[1] === 'me'),
        });
      }
    });
  }, [queryClient]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(),
  });

  const logout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      queryClient.setQueryData(['auth', 'me'], null);
      queryClient.removeQueries({
        predicate: (query) =>
          !(query.queryKey[0] === 'auth' && query.queryKey[1] === 'me'),
      });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: data?.user ?? null,
        isLoading,
        isError,
        refetchUser: () => {
          void refetch();
        },
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

import axios, { AxiosError } from 'axios';
import type { ParsedApiError } from '../types/api';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorizedResponse(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 15000,
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const requestUrl = error.config?.url || '';
      const isPublicAuthAttempt =
        requestUrl.includes('/auth/login') ||
        requestUrl.includes('/auth/register') ||
        requestUrl.includes('/auth/logout');

      if (!isPublicAuthAttempt) {
        for (const listener of unauthorizedListeners) {
          listener();
        }
      }
    }
    return Promise.reject(error);
  }
);

export function extractApiError(err: unknown): ParsedApiError {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<{
      error?: {
        id?: string;
        code?: string;
        message?: string;
        details?: unknown;
      };
    }>;

    const apiError = axiosErr.response?.data?.error;
    if (apiError) {
      let message = apiError.message || 'Request failed';
      if (
        Array.isArray(apiError.details) &&
        apiError.details.length > 0 &&
        typeof apiError.details[0]?.message === 'string'
      ) {
        message = `${message}: ${apiError.details
          .map((d: { path?: string; message: string }) =>
            d.path ? `${d.path} (${d.message})` : d.message
          )
          .join(', ')}`;
      }
      return {
        id: apiError.id,
        code: apiError.code || 'API_ERROR',
        message,
        details: apiError.details,
        status: axiosErr.response?.status,
      };
    }

    return {
      code: 'NETWORK_ERROR',
      message:
        axiosErr.message ||
        'Unable to reach the server. Please check your connection and try again.',
      status: axiosErr.response?.status,
    };
  }

  if (err instanceof Error) {
    return {
      code: 'CLIENT_ERROR',
      message: err.message,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred.',
  };
}

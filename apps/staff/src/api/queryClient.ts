import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './client';

/** Only connection problems and server errors are worth retrying; 4xx answers will not change. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!isApiError(error)) return false;
  return (error.code === 'NETWORK' || error.status >= 500) && failureCount < 2;
}

/** Server state for the staff portal (Tech Stack 7.1: TanStack Query, no global store). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

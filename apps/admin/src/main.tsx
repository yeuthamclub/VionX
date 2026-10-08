import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { colors, toCssVariables } from '@vionx/tokens';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './router.tsx';
import './styles.css';

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) Sentry.init({ dsn, environment: import.meta.env.MODE });

for (const [name, value] of Object.entries(toCssVariables(colors.light))) {
  document.documentElement.style.setProperty(name, value);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

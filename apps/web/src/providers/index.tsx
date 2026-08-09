'use client';

import { Toaster } from 'sonner';
import type { ReactNode } from 'react';

import { AuthProvider } from './auth-provider';
import { QueryProvider } from './query-provider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          richColors
          closeButton
          toastOptions={{ className: 'font-sans' }}
        />
      </AuthProvider>
    </QueryProvider>
  );
}

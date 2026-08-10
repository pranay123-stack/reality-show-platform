import type { ReactNode } from 'react';

import { AdminLayout } from '@/components/admin/admin-layout';

/**
 * Wraps every `/admin/*` route.
 *
 * The pages built in earlier phases — challenge moderation, rewards, the
 * leaderboard and notification consoles — pick this up automatically, which is
 * how they join the console without being rewritten.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}

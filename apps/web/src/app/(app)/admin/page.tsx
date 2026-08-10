import type { Metadata } from 'next';

import { AdminOverview } from '@/components/admin/admin-overview';

export const metadata: Metadata = { title: 'Console' };

export default function Page() {
  return <AdminOverview />;
}

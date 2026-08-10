import type { Metadata } from 'next';

import { AuditSection } from '@/components/admin/audit-section';

export const metadata: Metadata = { title: 'Audit' };

export default function Page() {
  return <AuditSection />;
}

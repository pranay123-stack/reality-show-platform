import type { Metadata } from 'next';

import { WeekendSection } from '@/components/admin/weekend-section';

export const metadata: Metadata = { title: 'Weekend' };

export default function Page() {
  return <WeekendSection />;
}

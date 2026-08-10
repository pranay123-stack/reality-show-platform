import type { Metadata } from 'next';

import { WeekendScreen } from '@/components/weekend/weekend-screen';

export const metadata: Metadata = { title: 'Weekend Spotlight' };

export default function WeekendPage() {
  return <WeekendScreen />;
}

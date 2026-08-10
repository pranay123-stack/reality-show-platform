import type { Metadata } from 'next';

import { PredictionsSection } from '@/components/admin/predictions-section';

export const metadata: Metadata = { title: 'Predictions' };

export default function Page() {
  return <PredictionsSection />;
}

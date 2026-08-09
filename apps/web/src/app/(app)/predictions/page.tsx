import type { Metadata } from 'next';

import { PredictionsScreen } from '@/components/predictions/predictions-screen';

export const metadata: Metadata = { title: 'Prediction Game' };

export default function PredictionsPage() {
  return <PredictionsScreen />;
}

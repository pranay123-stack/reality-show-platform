import type { Metadata } from 'next';

import { PredictionsScreen } from '@/components/predictions/predictions-screen';

export const metadata: Metadata = { title: 'Make Your Prediction' };

export default function PredictionsPage() {
  return <PredictionsScreen />;
}

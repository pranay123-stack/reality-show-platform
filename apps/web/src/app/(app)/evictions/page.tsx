import type { Metadata } from 'next';

import { RoundScreen } from '@/components/rounds/round-screen';

export const metadata: Metadata = { title: 'Eviction round' };

export default function EvictionsPage() {
  return <RoundScreen kind="evictions" />;
}

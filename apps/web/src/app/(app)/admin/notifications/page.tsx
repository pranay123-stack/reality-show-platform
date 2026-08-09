import type { Metadata } from 'next';

import { NotificationAdmin } from '@/components/notifications/notification-admin';

export const metadata: Metadata = { title: 'Notification health' };

export default function Page() {
  return <NotificationAdmin />;
}

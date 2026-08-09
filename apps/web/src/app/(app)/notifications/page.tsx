import type { Metadata } from 'next';

import { NotificationPage } from '@/components/notifications/notification-page';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return <NotificationPage />;
}

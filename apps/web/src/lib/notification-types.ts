export type NotificationType = 'ASSIGNED' | 'MENTIONED' | 'STATUS_CHANGED' | 'COMMENT' | 'DUE_SOON' | 'OVERDUE' | 'BLOCKED';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  item: { id: string; key: string; title: string } | null;
}

export interface NotificationsPage {
  notifications: Notification[];
  total: number;
  page: number;
  pageSize: number;
}

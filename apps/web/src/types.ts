export type Role = 'ADMIN' | 'MANAGER' | 'DEVELOPER';
export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type ItemType = 'TASK' | 'BUG' | 'RISK' | 'ENHANCEMENT';
export type ItemStatus = 'BACKLOG' | 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'IN_REVIEW' | 'DONE';
export type ItemPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type ItemRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive?: boolean;
  createdAt?: string;
  assignedItemsCount?: number;
  openAssignedItemsCount?: number;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  description: string;
  status: ProjectStatus;
  ownerId: string;
  owner: User;
  members: { user: User }[];
  _count?: { items: number };
}

export interface Item {
  id: string;
  projectId: string;
  key: string;
  type: ItemType;
  title: string;
  description: string;
  status: ItemStatus;
  priority: ItemPriority;
  risk: ItemRisk;
  assigneeId: string | null;
  reporterId: string;
  dueDate: string | null;
  estimateHours: number | null;
  spentHours: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  startedAt: string | null;
  score: number;
  project: { id: string; name: string; code: string };
  assignee: User | null;
  reporter: User;
}

export interface DashboardResponse {
  buckets: {
    overdue: Item[];
    dueSoon: Item[];
    blocked: Item[];
    needsAttention: Item[];
  };
  summary: {
    totalOpen: number;
    totalDone: number;
    overdue: number;
    blocked: number;
    dueSoon: number;
    needsAttention: number;
  };
  myItems: Item[];
  perProjectOpenCounts: { id: string; name: string; code: string; openCount: number }[];
  stale: Item[];
}

export interface CommentAuthor {
  id: string;
  name: string;
  email?: string;
}

export interface ItemComment {
  id: string;
  itemId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  author: CommentAuthor;
  pending?: boolean;
}

export interface CommentsPage {
  comments: ItemComment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MentionableUser {
  id: string;
  name: string;
  email?: string;
  role?: Role;
  isActive?: boolean;
}

export type ActivityAction = 'CREATED' | 'UPDATED' | 'STATUS_CHANGED' | 'ASSIGNED' | 'COMMENTED' | 'DELETED' | 'IMPORTED' | 'BULK_UPDATED';

export interface ActivityEntry {
  id: string;
  itemId: string | null;
  projectId: string;
  userId: string;
  action: ActivityAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: CommentAuthor | null;
}

export interface ActivityPage {
  activity: ActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
}

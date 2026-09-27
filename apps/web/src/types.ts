export type Role = 'ADMIN' | 'MANAGER' | 'DEVELOPER';
export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type ItemType = 'TASK' | 'BUG' | 'RISK' | 'ENHANCEMENT';
export type ItemStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'IN_REVIEW' | 'DONE';
export type ItemPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type ItemRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
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

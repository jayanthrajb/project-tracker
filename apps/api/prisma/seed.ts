import { ItemPriority, ItemRisk, ItemStatus, ItemType, PrismaClient, ProjectStatus, UserRole } from '@prisma/client';

import { hashPassword } from '../src/lib/auth.js';
import '../src/lib/env.js';

const prisma = new PrismaClient();
const defaultPassword = 'Password123!';

function daysFromNow(days?: number | null) {
  if (days === null || days === undefined) return null;
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  await prisma.projectMember.deleteMany();
  await prisma.item.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await hashPassword(defaultPassword);

  const users = await Promise.all([
    prisma.user.create({ data: { name: 'Alice Admin', email: 'alice.admin@example.com', passwordHash, role: UserRole.ADMIN } }),
    prisma.user.create({ data: { name: 'Sara Manager', email: 'sara.manager@example.com', passwordHash, role: UserRole.MANAGER } }),
    prisma.user.create({ data: { name: 'Ava Developer', email: 'ava@example.com', passwordHash, role: UserRole.DEVELOPER } }),
    prisma.user.create({ data: { name: 'Noah Developer', email: 'noah@example.com', passwordHash, role: UserRole.DEVELOPER } }),
    prisma.user.create({ data: { name: 'Mia Developer', email: 'mia@example.com', passwordHash, role: UserRole.DEVELOPER } }),
    prisma.user.create({ data: { name: 'Liam Developer', email: 'liam@example.com', passwordHash, role: UserRole.DEVELOPER } }),
  ]);

  const [admin, manager, ava, noah, mia, liam] = users;

  const projects = await Promise.all([
    prisma.project.create({ data: { name: 'App Modernization', code: 'APP', description: 'Modernize the customer-facing app shell and reporting experience.', status: ProjectStatus.ACTIVE, ownerId: manager.id } }),
    prisma.project.create({ data: { name: 'Operations Reliability', code: 'OPS', description: 'Reduce release friction and improve deployment confidence.', status: ProjectStatus.ACTIVE, ownerId: manager.id } }),
    prisma.project.create({ data: { name: 'CRM Cleanup', code: 'CRM', description: 'Streamline sales operations and fix high-friction account workflows.', status: ProjectStatus.ON_HOLD, ownerId: admin.id } }),
  ]);

  await prisma.projectMember.createMany({
    data: projects.flatMap((project) => users.map((user) => ({ projectId: project.id, userId: user.id }))),
  });

  const templates: Array<{
    title: string;
    description: string;
    type: ItemType;
    status: ItemStatus;
    priority: ItemPriority;
    risk: ItemRisk;
    assigneeId: string | null;
    reporterId: string;
    dueInDays: number | null;
    estimateHours: number;
    spentHours: number;
    tags: string[];
    updatedDaysAgo?: number;
  }> = [
    {
      title: 'Stabilize dashboard filtering',
      description: 'Fix manager dashboard filtering edge cases before leadership review.',
      type: ItemType.TASK,
      status: ItemStatus.IN_PROGRESS,
      priority: ItemPriority.P1,
      risk: ItemRisk.MEDIUM,
      assigneeId: ava.id,
      reporterId: manager.id,
      dueInDays: -2,
      estimateHours: 8,
      spentHours: 5,
      tags: ['dashboard', 'frontend'],
    },
    {
      title: 'Resolve login timeout in edge browsers',
      description: 'Users intermittently lose their session after long idle periods.',
      type: ItemType.BUG,
      status: ItemStatus.BLOCKED,
      priority: ItemPriority.P0,
      risk: ItemRisk.HIGH,
      assigneeId: noah.id,
      reporterId: manager.id,
      dueInDays: -1,
      estimateHours: 10,
      spentHours: 6,
      tags: ['auth', 'api'],
    },
    {
      title: 'Review feature flag cleanup',
      description: 'Remove stale flags left behind after the redesign rollout.',
      type: ItemType.ENHANCEMENT,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P2,
      risk: ItemRisk.LOW,
      assigneeId: null,
      reporterId: manager.id,
      dueInDays: 2,
      estimateHours: 4,
      spentHours: 0,
      tags: ['tech-debt'],
    },
    {
      title: 'Map risks for reporting migration',
      description: 'Assess migration risks and propose rollback checkpoints.',
      type: ItemType.RISK,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P1,
      risk: ItemRisk.HIGH,
      assigneeId: mia.id,
      reporterId: manager.id,
      dueInDays: 5,
      estimateHours: 6,
      spentHours: 1,
      tags: ['reporting', 'planning'],
    },
    {
      title: 'Tighten QA sign-off checklist',
      description: 'Document sign-off expectations before the next release cut.',
      type: ItemType.TASK,
      status: ItemStatus.IN_REVIEW,
      priority: ItemPriority.P2,
      risk: ItemRisk.MEDIUM,
      assigneeId: liam.id,
      reporterId: manager.id,
      dueInDays: 1,
      estimateHours: 5,
      spentHours: 3,
      tags: ['qa'],
    },
    {
      title: 'Backfill project due dates',
      description: 'Several legacy items still need owner-confirmed due dates.',
      type: ItemType.TASK,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P3,
      risk: ItemRisk.LOW,
      assigneeId: null,
      reporterId: manager.id,
      dueInDays: null,
      estimateHours: 2,
      spentHours: 0,
      tags: ['cleanup'],
    },
    {
      title: 'Close completed maintenance item',
      description: 'Mark the already-delivered maintenance work done and archive notes.',
      type: ItemType.TASK,
      status: ItemStatus.DONE,
      priority: ItemPriority.P3,
      risk: ItemRisk.LOW,
      assigneeId: ava.id,
      reporterId: manager.id,
      dueInDays: -7,
      estimateHours: 2,
      spentHours: 2,
      tags: ['maintenance'],
    },
    {
      title: 'Refresh deployment runbook',
      description: 'Operations needs the latest rollback and database cutover steps.',
      type: ItemType.ENHANCEMENT,
      status: ItemStatus.IN_PROGRESS,
      priority: ItemPriority.P1,
      risk: ItemRisk.MEDIUM,
      assigneeId: liam.id,
      reporterId: admin.id,
      dueInDays: 3,
      estimateHours: 5,
      spentHours: 2,
      tags: ['ops', 'docs'],
      updatedDaysAgo: 6,
    },
    {
      title: 'Investigate flaky nightly sync',
      description: 'The CRM sync intermittently stalls and leaves stale customer data.',
      type: ItemType.BUG,
      status: ItemStatus.BLOCKED,
      priority: ItemPriority.P0,
      risk: ItemRisk.HIGH,
      assigneeId: mia.id,
      reporterId: admin.id,
      dueInDays: -3,
      estimateHours: 12,
      spentHours: 7,
      tags: ['crm', 'integration'],
    },
    {
      title: 'Add ownership for orphaned backlog items',
      description: 'A few backlog items were imported from Excel without assignees.',
      type: ItemType.TASK,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P1,
      risk: ItemRisk.MEDIUM,
      assigneeId: null,
      reporterId: manager.id,
      dueInDays: 4,
      estimateHours: 3,
      spentHours: 0,
      tags: ['triage'],
    },
    {
      title: 'Clarify launch messaging',
      description: 'Prepare PM-friendly copy for the next stakeholder rollout summary.',
      type: ItemType.ENHANCEMENT,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P2,
      risk: ItemRisk.LOW,
      assigneeId: ava.id,
      reporterId: manager.id,
      dueInDays: 6,
      estimateHours: 3,
      spentHours: 0,
      tags: ['copy'],
    },
    {
      title: 'Reconcile carried-over production defects',
      description: 'Verify which defects are still open after the last hotfix batch.',
      type: ItemType.BUG,
      status: ItemStatus.IN_PROGRESS,
      priority: ItemPriority.P1,
      risk: ItemRisk.MEDIUM,
      assigneeId: noah.id,
      reporterId: manager.id,
      dueInDays: 0,
      estimateHours: 7,
      spentHours: 4,
      tags: ['triage', 'prod'],
      updatedDaysAgo: 7,
    },
    {
      title: 'Capture dependency risk for vendor API',
      description: 'The vendor has announced an API sunset that needs a mitigation plan.',
      type: ItemType.RISK,
      status: ItemStatus.OPEN,
      priority: ItemPriority.P0,
      risk: ItemRisk.HIGH,
      assigneeId: manager.id,
      reporterId: admin.id,
      dueInDays: 2,
      estimateHours: 2,
      spentHours: 1,
      tags: ['vendor', 'risk'],
    },
  ];

  for (const project of projects) {
    let sequence = 1;
    for (const template of templates) {
      const createdAt = daysFromNow(-(sequence + 2)) ?? new Date();
      const updatedAt = template.updatedDaysAgo ? daysFromNow(-template.updatedDaysAgo) ?? createdAt : daysFromNow(-(sequence % 4)) ?? createdAt;
      await prisma.item.create({
        data: {
          projectId: project.id,
          key: `${project.code}-${sequence}`,
          type: template.type,
          title: `${template.title} (${project.code})`,
          description: template.description,
          status: template.status,
          priority: template.priority,
          risk: template.risk,
          assigneeId: template.assigneeId,
          reporterId: template.reporterId,
          dueDate: daysFromNow(template.dueInDays),
          estimateHours: template.estimateHours,
          spentHours: template.spentHours,
          tags: template.tags,
          createdAt,
          updatedAt,
          closedAt: template.status === ItemStatus.DONE ? updatedAt : null,
        },
      });
      sequence += 1;
    }
  }

  console.log('Seed complete. Use any of the following credentials:');
  console.table([
    { role: 'ADMIN', email: admin.email, password: defaultPassword },
    { role: 'MANAGER', email: manager.email, password: defaultPassword },
    { role: 'DEVELOPER', email: ava.email, password: defaultPassword },
    { role: 'DEVELOPER', email: noah.email, password: defaultPassword },
    { role: 'DEVELOPER', email: mia.email, password: defaultPassword },
    { role: 'DEVELOPER', email: liam.email, password: defaultPassword },
  ]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

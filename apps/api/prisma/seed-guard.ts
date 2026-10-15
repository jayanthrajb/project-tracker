// Capture this before the API environment loader can override NODE_ENV from a .env file.
const startedInProduction = process.env.NODE_ENV === 'production';

const tables = [
  'projectMember',
  'item',
  'project',
  'user',
  'itemDependency',
  'activityLog',
  'comment',
  'mention',
  'notification',
  'savedView',
  'attachment',
] as const;

type SeedDatabase = Record<(typeof tables)[number], { count: () => Promise<number> }>;

export async function assertSeedAllowed(
  prisma: SeedDatabase,
  env: NodeJS.ProcessEnv = process.env,
  args: readonly string[] = process.argv.slice(2),
) {
  if (startedInProduction || env.NODE_ENV === 'production') {
    throw new Error('Seeding is disabled in production. There is no override.');
  }

  if (args.includes('--force') || env.SEED_FORCE === 'true') return;

  console.error('Seed refused: this would delete all rows in the following tables (including cascading deletes):');
  for (const table of tables) {
    console.error(`${table}: ${await prisma[table].count()}`);
  }
  throw new Error(
    'No data was changed. To delete this data and seed demos, run SEED_FORCE=true npm run db:seed ' +
    'or pass --force to the seed script (npm run db:seed -w @project-tracker/api -- -- --force).',
  );
}

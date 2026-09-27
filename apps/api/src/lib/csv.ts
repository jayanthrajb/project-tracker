import { ItemPriority, ItemRisk, ItemStatus, ItemType } from '@prisma/client';
import Papa from 'papaparse';
import { z } from 'zod';

const rowSchema = z.object({
  projectCode: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  type: z.nativeEnum(ItemType),
  status: z.nativeEnum(ItemStatus).default(ItemStatus.OPEN),
  priority: z.nativeEnum(ItemPriority).default(ItemPriority.P2),
  risk: z.nativeEnum(ItemRisk).default(ItemRisk.MEDIUM),
  assigneeEmail: z.string().email().optional().or(z.literal('')).transform((value) => value || undefined),
  reporterEmail: z.string().email(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD date')
    .optional()
    .or(z.literal(''))
    .transform((value) => value || undefined),
  estimateHours: z.coerce.number().optional(),
  spentHours: z.coerce.number().optional().default(0),
  tags: z.string().optional().default(''),
});

export type ParsedImportRow = z.infer<typeof rowSchema>;

export function parseCsvRows(input: string) {
  return Papa.parse<Record<string, string>>(input, {
    header: true,
    skipEmptyLines: true,
  });
}

export function normalizeImportRows(rows: Record<string, string>[], mapping?: Record<string, string>) {
  const results: { index: number; data?: ParsedImportRow; errors: string[] }[] = [];

  rows.forEach((row, index) => {
    const mapped = Object.entries(row).reduce<Record<string, string>>((acc, [key, value]) => {
      const target = mapping?.[key] ?? key;
      acc[target] = value;
      return acc;
    }, {});

    const parsed = rowSchema.safeParse(mapped);
    if (!parsed.success) {
      results.push({
        index,
        errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
      return;
    }

    results.push({ index, data: parsed.data, errors: [] });
  });

  return results;
}

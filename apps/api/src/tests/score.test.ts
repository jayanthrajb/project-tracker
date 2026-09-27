import { ItemPriority, ItemRisk, ItemStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { calculateItemScore } from '../lib/score.js';

describe('calculateItemScore', () => {
  it('returns zero for done items', () => {
    expect(
      calculateItemScore({
        priority: ItemPriority.P0,
        risk: ItemRisk.HIGH,
        status: ItemStatus.DONE,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        dueDate: new Date('2026-09-02T00:00:00Z'),
      }, new Date('2026-09-10T00:00:00Z')),
    ).toBe(0);
  });

  it('boosts blocked and overdue items', () => {
    expect(
      calculateItemScore({
        priority: ItemPriority.P0,
        risk: ItemRisk.HIGH,
        status: ItemStatus.BLOCKED,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        dueDate: new Date('2026-09-05T00:00:00Z'),
      }, new Date('2026-09-10T00:00:00Z')),
    ).toBeGreaterThan(48);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeImportRows, parseCsvRows } from '../lib/csv.js';

describe('csv import parsing', () => {
  it('normalizes valid rows', () => {
    const parsed = parseCsvRows(`projectCode,title,description,type,status,priority,risk,assigneeEmail,reporterEmail,dueDate,estimateHours,spentHours,tags\nAPP,Fix auth,Details,TASK,OPEN,P1,HIGH,ava@example.com,sara.manager@example.com,2026-10-01,4,1,auth`);
    const rows = normalizeImportRows(parsed.data);

    expect(rows[0].errors).toEqual([]);
    expect(rows[0].data?.projectCode).toBe('APP');
    expect(rows[0].data?.assigneeEmail).toBe('ava@example.com');
  });

  it('reports per-row validation failures', () => {
    const parsed = parseCsvRows(`projectCode,title,description,type,status,priority,risk,assigneeEmail,reporterEmail\n,Missing fields,Details,TASK,OPEN,P1,HIGH,not-an-email,nope`);
    const rows = normalizeImportRows(parsed.data);

    expect(rows[0].errors.length).toBeGreaterThan(0);
  });

  it('preserves relationship column presence and ignores the exported inverse on import', () => {
    const parsed = parseCsvRows(
      'projectCode,title,type,reporterEmail,ParentKey,BlocksKeys,BlockedByKeys,RelatesToKeys\n'
      + 'APP,Linked item,TASK,sara@example.com,,APP-2,APP-3,',
    );
    const [row] = normalizeImportRows(parsed.data);

    expect(row.data?.relationshipColumns).toEqual({
      parentKey: true,
      blocksKeys: true,
      relatesToKeys: true,
    });
    expect(row.data?.parentKey).toBe('');
    expect(row.data?.blockedByKeys).toBe('');
  });

  it('distinguishes absent relationship columns from blank ones', () => {
    const parsed = parseCsvRows('projectCode,title,type,reporterEmail\nAPP,Unchanged,TASK,sara@example.com');
    const [row] = normalizeImportRows(parsed.data);

    expect(row.data?.relationshipColumns).toEqual({
      parentKey: false,
      blocksKeys: false,
      relatesToKeys: false,
    });
  });
});

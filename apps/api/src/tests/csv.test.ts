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
});

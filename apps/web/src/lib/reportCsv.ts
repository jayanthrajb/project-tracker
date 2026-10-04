import Papa from 'papaparse';

export type ReportCsvRow = Record<string, string | number | null>;

export function buildReportCsv(
  report: string,
  project: string,
  range: { from: string; to: string },
  fields: string[],
  rows: ReportCsvRow[],
) {
  const safeName = (value: string) => value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'project';
  return {
    filename: `${safeName(report)}-${safeName(project)}-${range.from}-to-${range.to}.csv`,
    content: Papa.unparse({ fields, data: rows }),
  };
}

export function downloadReportCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

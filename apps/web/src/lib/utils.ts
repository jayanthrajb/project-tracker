export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export function toDateInput(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

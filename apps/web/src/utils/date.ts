const BANGKOK_TIMEZONE = 'Asia/Bangkok';

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANGKOK_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateOnlyFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANGKOK_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

export function formatBangkokDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return `${dateTimeFormatter.format(date)} (Asia/Bangkok)`;
}

export function formatBangkokDate(isoString?: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return dateOnlyFormatter.format(date);
}

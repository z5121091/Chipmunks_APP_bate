import { formatDateTime } from '@/utils/time';

/** Print task rows can contain local SQLite dates or older numeric timestamps. */
export const formatPrintTaskTime = (value: unknown): string => {
  if (value === null || value === undefined || (typeof value !== 'string' && typeof value !== 'number')) return '-';
  const text = typeof value === 'string' ? value.trim() : '';
  if (typeof value === 'string' && !text) return '-';
  let date: Date;
  if (typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(text)) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return '-';
    date = new Date(Math.abs(timestamp) < 100_000_000_000 ? timestamp * 1000 : timestamp);
  } else {
    const local = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (local) {
      const [, year, month, day, hour = '0', minute = '0', second = '0'] = local;
      date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
      if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 ||
        date.getDate() !== Number(day) || date.getHours() !== Number(hour) ||
        date.getMinutes() !== Number(minute) || date.getSeconds() !== Number(second)) return '-';
    } else {
      date = new Date(text);
    }
  }
  return Number.isFinite(date.getTime()) ? formatDateTime(date.toISOString()) : '-';
};

import { formatPrintTaskTime } from '../printTaskTime';
import { formatDateTime } from '../time';

it.each([undefined, null, '', '   ', 'invalid', 'Invalid Date', Number.NaN, Infinity, {}, '2026/13/13 12:00', '2026/02/30 12:00'])(
'uses a placeholder for a missing or invalid task date %p', value => {
  expect(formatPrintTaskTime(value)).toBe('-');
});

it('formats the local SQLite date without relying on native slash-date parsing', () => {
  expect(formatPrintTaskTime('2026/10/13 08:09')).toBe('2026-10-13 08:09');
  expect(formatPrintTaskTime('2026-10-13 08:09:10')).toBe('2026-10-13 08:09');
});

it('accepts ISO dates and numeric second or millisecond timestamps', () => {
  const iso = '2026-10-13T00:09:10.000Z';
  const timestamp = Date.parse(iso);
  const expected = formatDateTime(iso);
  expect(formatPrintTaskTime(iso)).toBe(expected);
  expect(formatPrintTaskTime(timestamp)).toBe(expected);
  expect(formatPrintTaskTime(timestamp / 1000)).toBe(expected);
  expect(formatPrintTaskTime(String(timestamp))).toBe(expected);
  expect(formatPrintTaskTime(String(timestamp / 1000))).toBe(expected);
});

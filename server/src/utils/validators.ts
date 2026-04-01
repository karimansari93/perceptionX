import { PeriodRange } from '../types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function isValidPeriod(value: string): boolean {
  return PERIOD_REGEX.test(value);
}

export function parsePeriod(period: string): PeriodRange {
  const [year, month] = period.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // last day of month

  const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    label,
  };
}

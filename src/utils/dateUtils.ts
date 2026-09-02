const pad = (value: number) => value.toString().padStart(2, '0');

export const parseDateInputValue = (value: string) => {
  if (!value) return Number.NaN;

  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return Number.NaN;
  }

  // Noon UTC avoids date drift when the browser is behind UTC.
  return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
};

export const formatDateInputValue = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const formatDisplayDate = (timestamp: number, locale = 'es-PY') =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
  }).format(new Date(timestamp));

export const addUtcMonthsPreservingDay = (timestamp: number, months: number) => {
  const date = new Date(timestamp);
  const targetYear = date.getUTCFullYear();
  const targetMonthIndex = date.getUTCMonth() + months;
  const targetDay = date.getUTCDate();

  const firstDayOfTargetMonth = Date.UTC(targetYear, targetMonthIndex, 1, 12, 0, 0, 0);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0, 12, 0, 0, 0)
  ).getUTCDate();

  return Date.UTC(
    new Date(firstDayOfTargetMonth).getUTCFullYear(),
    new Date(firstDayOfTargetMonth).getUTCMonth(),
    Math.min(targetDay, lastDayOfTargetMonth),
    12,
    0,
    0,
    0
  );
};

export const getCalendarMonthSpanFromDays = (days: number) =>
  Math.max(1, Math.round((days || 30) / 30));

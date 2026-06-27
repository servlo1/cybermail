import { format, isToday, isYesterday, isThisYear, fromUnixTime } from 'date-fns';

export function formatDate(unixTs) {
  if (!unixTs) return '';
  const date = unixTs > 1e10 ? new Date(unixTs) : fromUnixTime(unixTs);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Yesterday';
  if (isThisYear(date)) return format(date, 'MMM d');
  return format(date, 'MM/dd/yy');
}

export function formatDateFull(unixTs) {
  if (!unixTs) return '';
  const date = unixTs > 1e10 ? new Date(unixTs) : fromUnixTime(unixTs);
  return format(date, "EEE, MMM d yyyy 'at' HH:mm");
}

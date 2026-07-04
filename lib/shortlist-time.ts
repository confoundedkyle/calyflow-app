export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatShortlistDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortlistAddedAt(iso: string, now = new Date()): string {
  const addedAt = new Date(iso);
  if (Number.isNaN(addedAt.getTime())) return "—";

  if (!isSameLocalDay(addedAt, now)) return formatShortlistDateTime(addedAt);

  const elapsedMs = Math.max(0, now.getTime() - addedAt.getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 2) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 2) return "an hour ago";
  return `${hours} hours ago`;
}

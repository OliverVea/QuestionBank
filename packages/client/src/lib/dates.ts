/** Whole days from now until `iso` (≥ 1 by construction for a future review), as "N days". */
export function daysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

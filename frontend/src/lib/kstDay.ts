const OFFSET = 9 * 60 * 60 * 1000
export const DAY_MS = 86_400_000
export function kstDay(value: string | number | Date): string {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value
  return new Date(ms + OFFSET).toISOString().slice(0, 10)
}
export function kstDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00+09:00`)
}

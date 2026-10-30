/**
 * Dates and times on screen are KST (Asia/Seoul), whatever the computer's time zone, so a day here
 * is the same day the server's daily stats use (ADR 0027·0029). Day keys are "YYYY-MM-DD".
 */
export const KST = 'Asia/Seoul'

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' })

/** KST calendar day of an instant, e.g. "2026-10-26". */
export function kstDay(at: string | number | Date): string {
  return DAY.format(typeof at === 'string' ? new Date(at) : at)
}

/** `day` moved by `n` calendar days. Pure date arithmetic: no time zone is involved. */
export function addDayKey(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The instant a KST day starts (00:00 KST), in ms. */
export function kstDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00+09:00`)
}

/** "오후 3:05" in KST. */
export function kstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { timeZone: KST, hour: 'numeric', minute: '2-digit' })
}

/** "2026. 10. 26. 오후 3:05:09" in KST. */
export function kstDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: KST })
}

/** 계획서의 통계 정의를 그대로 옮긴 헬퍼들 */

export function mean(xs: number[]) {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function median(xs: number[]) {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * 유지율. 계획서에 따라 유효 측정 시간이 0이면 0%가 아니라
 * 계산 불가(null)로 돌려준다.
 */
export function ratio(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return part / whole
}

export function formatPercent(v: number | null, digits = 1) {
  if (v === null) return '계산 불가'
  return `${(v * 100).toFixed(digits)}%`
}

/** 00:00 형태. 측정 타이머용 */
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 1시간 23분 / 4분 12초 형태. 통계 표기용 */
export function formatDuration(seconds: number | null) {
  if (seconds === null) return '계산 불가'
  const s = Math.round(seconds)
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`
}

export function formatRate(value: number | null, unit: string, digits = 1) {
  if (value === null) return '계산 불가'
  return `${value.toFixed(digits)}${unit}`
}

/** 전후 비교의 변화량 표기 */
export function delta(now: number | null, before: number | null) {
  if (now === null || before === null) return null
  return now - before
}

import { MODEL_VERSION } from './posture'

export type DayRecord = {
  date: string
  label: string
  weekday: string
  sessions: number
  /** 유효 측정 시간(초) = 전체 − 일시정지 − 자리비움 − 판정 불가 */
  validSeconds: number
  /** 판정 불가로 제외된 시간(초) */
  excludedSeconds: number
  goodSeconds: number
  events: number
  alerts: number
  /** 붕괴 발생 간격 표본(초) */
  intervals: number[]
  /** 회복 시간 표본(초) */
  recoveries: number[]
}

/** 시연용 난수. 새로고침해도 같은 그래프가 나오도록 시드를 고정한다. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const DAYS = 14

/**
 * 최근 14일 기록. 뒤로 갈수록 유지율이 오르고 붕괴 간격이 길어지도록
 * 만들어, 계획서의 전후 비교 지표가 의미 있게 보이도록 했다.
 */
function buildHistory(): DayRecord[] {
  const rnd = seeded(20260901)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const out: DayRecord[] = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const progress = (DAYS - 1 - i) / (DAYS - 1)
    const weekend = d.getDay() === 0 || d.getDay() === 6

    const sessions = weekend ? 1 + Math.round(rnd()) : 2 + Math.round(rnd() * 2)
    const validSeconds = Math.round((weekend ? 2400 : 5400) * (0.75 + rnd() * 0.5))
    const excludedSeconds = Math.round(validSeconds * (0.04 + rnd() * 0.05))

    // 유지율 62% 근방에서 시작해 82% 근방까지 개선
    const keepRate = 0.62 + progress * 0.2 + (rnd() - 0.5) * 0.06
    const goodSeconds = Math.round(validSeconds * Math.min(keepRate, 0.93))

    // 시간당 붕괴 횟수는 반대로 감소
    const perHour = 5.4 - progress * 2.3 + (rnd() - 0.5) * 0.9
    const events = Math.max(1, Math.round((validSeconds / 3600) * perHour))
    const alerts = events + Math.round(events * (0.45 - progress * 0.25))

    const baseInterval = 420 + progress * 380
    const intervals = Array.from({ length: Math.max(1, events - 1) }, () =>
      Math.round(baseInterval * (0.5 + rnd() * 1.1)),
    )
    const baseRecovery = 26 - progress * 11
    const recoveries = Array.from({ length: events }, () =>
      Math.round(baseRecovery * (0.55 + rnd() * 1.3)),
    )

    out.push({
      date: d.toISOString().slice(0, 10),
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      weekday: WEEKDAYS[d.getDay()],
      sessions,
      validSeconds,
      excludedSeconds,
      goodSeconds,
      events,
      alerts,
      intervals,
      recoveries,
    })
  }
  return out
}

export const HISTORY = buildHistory()

export type Period = {
  title: string
  days: DayRecord[]
  modelVersion: string
}

/** 계획서의 전후 비교. 비교 기간·유효 시간·세션 수·모델 버전을 함께 남긴다. */
export const EARLY_PERIOD: Period = {
  title: '초기 구간',
  days: HISTORY.slice(0, 7),
  modelVersion: 'lstm-v0.2.4',
}

export const RECENT_PERIOD: Period = {
  title: '최근 구간',
  days: HISTORY.slice(7),
  modelVersion: MODEL_VERSION,
}

export type SessionSummary = {
  id: string
  startedAt: string
  validSeconds: number
  keepRate: number
  events: number
}

export const RECENT_SESSIONS: SessionSummary[] = HISTORY.slice(-5)
  .reverse()
  .map((d, i) => ({
    id: `S-${d.date.replace(/-/g, '')}-${i + 1}`,
    startedAt: `${d.label}(${d.weekday}) ${9 + i * 2}:${i % 2 ? '30' : '00'}`,
    validSeconds: Math.round(d.validSeconds / d.sessions),
    keepRate: d.goodSeconds / d.validSeconds,
    events: Math.max(1, Math.round(d.events / d.sessions)),
  }))

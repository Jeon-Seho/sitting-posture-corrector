import { formatDuration } from '../lib/stats'

/**
 * Numbers grouped by meaning, each group on its own tinted background (2026-10-13):
 * time, posture warnings and recovery read as three blocks instead of one list.
 * Shared by 일별 상세 and the session summary so the same words mean the same thing.
 */
export type Metric = { label: string; value: string; hint?: string }
export type MetricGroup = { title: string; tone: 'time' | 'warn' | 'recover'; items: Metric[] }

export function MetricGroups({ groups }: { groups: MetricGroup[] }) {
  return (
    <div className="metric-groups">
      {groups.map((group) => (
        <section key={group.title} className={`metric-group is-${group.tone}`} aria-label={group.title}>
          <h5 className="metric-group-title">{group.title}</h5>
          <dl className="metric-group-items">
            {group.items.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd className="num">{item.value}</dd>
                {item.hint && <span className="metric-hint">{item.hint}</span>}
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/** Same wording everywhere (user feedback 2026-10-13). */
export const METRIC_LABEL = {
  measured: '측정 시간',
  good: '바른 자세',
  deviation: '흐트러진 시간',
  unknown: '확인 못 한 시간',
  warnings: '자세 경고',
  alerts: '알림',
  interval: '경고 사이 평균 간격',
  recovery: '바로 앉기까지',
} as const

/** Durations as "2분 41초"; a value that cannot be computed shows as "—". */
const time = (seconds: number | null) => (seconds === null ? '—' : formatDuration(seconds))

/** Three groups for one day or one session. */
export function metricGroupsFor(m: {
  measured: number
  good: number
  deviation: number
  unknown: number
  warnings: number
  alerts: number
  interval: number | null
  recovery: number | null
}): MetricGroup[] {
  return [
    {
      title: '시간',
      tone: 'time',
      items: [
        { label: METRIC_LABEL.measured, value: time(m.measured) },
        { label: METRIC_LABEL.good, value: time(m.good) },
        { label: METRIC_LABEL.deviation, value: time(Math.max(0, m.deviation)) },
        { label: METRIC_LABEL.unknown, value: time(m.unknown), hint: '자리 비움·휴식 등, 측정 시간에서 빠져요' },
      ],
    },
    {
      title: '경고와 알림',
      tone: 'warn',
      items: [
        { label: METRIC_LABEL.warnings, value: `${m.warnings}번`, hint: '흐트러진 자세가 이어진 횟수' },
        { label: METRIC_LABEL.alerts, value: `${m.alerts}회`, hint: '다시 알림 포함' },
      ],
    },
    {
      title: '회복',
      tone: 'recover',
      items: [
        { label: METRIC_LABEL.interval, value: time(m.interval), hint: '경고가 다시 생기기까지' },
        { label: METRIC_LABEL.recovery, value: time(m.recovery), hint: '경고 뒤 바른 자세로 돌아오기까지' },
      ],
    },
  ]
}

import type { CSSProperties, ReactNode } from 'react'
import { ArrowUp, ArrowsHorizontal, ArrowsVertical, Cube, UserFocus } from '@phosphor-icons/react'
import type { ComparisonGeometry, ComparisonSample, ComparisonValues } from '../../../../model/prototype/observationComparison'
import { boldNumbers } from './observationTypography'

export const OBSERVATION_METRICS = [
  { key: 'headGap', title: '머리–어깨 간격', note: '＋ 코와 어깨 사이가 영상에서 더 벌어짐', family: '2D', icon: ArrowsVertical, color: 'var(--oc-cyan)' },
  { key: 'faceHeight', title: '얼굴 세로 길이', note: '＋ 눈 중점과 입 중점 사이가 더 길어짐', family: '2D', icon: UserFocus, color: 'var(--oc-orange)' },
  { key: 'shoulderLift', title: '어깨 높이', note: '＋ 양어깨 중점이 화면 위로 이동', family: '2D', icon: ArrowUp, color: 'var(--oc-mint)' },
  { key: 'shoulderScale', title: '어깨폭', note: '＋ 영상에서 양어깨 사이가 더 넓어짐', family: '2D', icon: ArrowsHorizontal, color: 'var(--oc-blue)' },
  { key: 'relativeZ', title: '코–어깨 상대 z', note: '＋ 코 z − 양어깨 평균 z가 더 커짐', family: 'Pose world', icon: Cube, color: 'var(--oc-pink)' },
] as const
export const valueText = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
function Trace({ samples, field, color }: { samples: ComparisonSample[]; field: keyof ComparisonValues; color: string }) {
  const end = samples.at(-1)?.timeMs ?? 0, start = end - 10000
  const extent = Math.max(5, ...samples.map(s => Math.abs(s.values?.[field] ?? 0))) * 1.15
  let open = false, last = 0
  const path = samples.map(s => {
    const value = s.values?.[field]
    if (value == null) { open = false; return '' }
    const command = open && s.timeMs - last <= 500 ? 'L' : 'M'
    open = true; last = s.timeMs
    return `${command}${((s.timeMs - start) / 10000 * 300).toFixed(1)},${(36 - value / extent * 30).toFixed(1)}`
  }).join(' ')
  return <div className="oc-trace"><svg viewBox="0 0 300 72" preserveAspectRatio="none" role="img" aria-label="최근 10초 기준 대비 변화. 누락 구간은 연결하지 않음."><path d="M0 36H300" stroke="currentColor" strokeDasharray="3 5" opacity=".25" /><path d={path} fill="none" stroke={color} strokeWidth="2" /></svg><small><span>{boldNumbers('−10초')}</span><span>{boldNumbers(`0 기준 · 세로축 ±${extent.toFixed(1)}%`)}</span><span>지금</span></small></div>
}

export function ObservationMetrics({ samples, values, depthNote, title }: { samples: ComparisonSample[]; values: ComparisonValues | null; depthNote?: ReactNode; title?: string }) {
  return <section className="oc-metrics" aria-label="기준 대비 2D와 상대 z">
    {title && <div className="oc-metrics-heading"><h2>{title}</h2></div>}
    <div className="oc-metrics-grid">{OBSERVATION_METRICS.map(metric => {
      const Icon = metric.icon
      const value = values?.[metric.key]
      return <article className={`oc-metric ${metric.key === 'relativeZ' ? 'oc-depth' : ''}`} key={metric.key} style={{ '--oc-metric-accent': metric.color } as CSSProperties}>
        <div className="oc-metric-label"><Icon size={23} weight="fill" aria-hidden="true" /><div className="oc-metric-titles"><h3>{metric.title}</h3><p className="oc-metric-note">{metric.note}</p></div><span>{boldNumbers(metric.family)}</span></div>
        <div className="oc-metric-reading"><strong>{boldNumbers(value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`)}</strong>{value != null && <span>%</span>}<small>기준 대비</small></div>
        <Trace samples={samples} field={metric.key} color={metric.color} />
      </article>
    })}{depthNote}</div>
  </section>
}

export function DepthNote({ current, reference }: { current: ComparisonGeometry | null; reference: ComparisonGeometry | null }) {
  return <article className="oc-metric oc-depth-note" style={{ '--oc-metric-accent': 'var(--oc-cyan)' } as CSSProperties}>
    <div className="oc-metric-label"><Cube size={23} weight="fill" aria-hidden="true" /><div className="oc-metric-titles"><h3>상대 z 좌표</h3></div><span>Pose world</span></div>
    <div className="oc-metric-reading"><strong>{boldNumbers(current?.world ? current.world.relativeZ.toFixed(3) : '—')}</strong>{current?.world && <span>m</span>}</div>
    <small className="oc-depth-reference">{boldNumbers(reference?.world ? `기준 ${reference.world.relativeZ.toFixed(3)} m · 모델 추정` : '기준 없음')}</small>
  </article>
}

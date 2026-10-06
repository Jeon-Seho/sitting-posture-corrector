import type { CollapseType } from '../../data/posture'
import type { LiveState } from '../../lib/engine'
import { postureScore } from '../../lib/postureScore'
import { ratio } from '../../lib/stats'

/**
 * Screen-facing status of a running measurement.
 *
 * It mirrors the planned platform state machine (NORMAL → SUSPECT → BAD → RECOVERING,
 * plus "analysis paused" when no inference arrives) so the screens do not depend on where
 * the decision is made. Today the local engine fills it through `fromLocalLive`; a future
 * realtime (WebSocket) adapter only has to produce the same shape.
 * See docs/design/frontend-platform-seams.md.
 */
export type LiveStatus =
  | 'normal'
  | 'suspect'
  | 'bad'
  | 'recovering'
  | 'unmeasurable'
  | 'paused'
  | 'analysisPaused'

export type LiveView = {
  status: LiveStatus
  collapse: CollapseType | null
  /** 0–100, higher = closer to the registered posture. Null when not measurable. */
  score: number | null
  /** 0–1 progress toward confirming a sustained change (suspect). */
  holdProgress: number
  /** 0–1 progress toward confirming recovery. */
  recoverProgress: number
  nextAlertIn: number | null
  notice: string | null
  totalSeconds: number
  validSeconds: number
  goodSeconds: number
  unknownSeconds: number
  keepRate: number | null
  events: number
  alerts: number
}

export function fromLocalLive(live: LiveState, paused: boolean): LiveView {
  const status: LiveStatus = paused
    ? 'paused'
    : live.state === 'unknown'
      ? 'unmeasurable'
      : live.alerting
        ? live.state === 'good' || live.recoverProgress > 0
          ? 'recovering'
          : 'bad'
        : live.state === 'collapse'
          ? 'suspect'
          : 'normal'
  return {
    status,
    collapse: live.collapse,
    score: postureScore(status === 'paused' || status === 'unmeasurable' ? null : live.collapseProb),
    holdProgress: live.holdProgress,
    recoverProgress: live.recoverProgress,
    nextAlertIn: live.nextAlertIn,
    notice: live.notice,
    totalSeconds: live.totalSeconds,
    validSeconds: live.validSeconds,
    goodSeconds: live.goodSeconds,
    unknownSeconds: live.unknownSeconds,
    keepRate: ratio(live.goodSeconds, live.validSeconds),
    events: live.events.length,
    alerts: live.events.reduce((sum, event) => sum + event.alerts, 0),
  }
}

/** Timeline buckets share three colours: on baseline, off baseline, not measured. */
export type TimelineKind = 'good' | 'collapse' | 'unknown' | 'paused'

export function timelineKind(status: LiveStatus): TimelineKind {
  if (status === 'paused') return 'paused'
  if (status === 'unmeasurable' || status === 'analysisPaused') return 'unknown'
  if (status === 'normal' || status === 'recovering') return 'good'
  return 'collapse'
}

export const COLLAPSE_TITLE: Record<CollapseType, string> = {
  forwardHead: '머리와 상체가 앞으로 나왔어요',
  tilt: '몸이 한쪽으로 기울었어요',
  referenceChange: '기준 자세와 달라졌어요',
}

export const COLLAPSE_HINT: Record<CollapseType, string> = {
  forwardHead: '턱을 살짝 당기고 등을 의자에 기대 볼까요?',
  tilt: '천천히 양쪽 어깨 높이를 맞춰 볼까요?',
  referenceChange: '처음 등록한 편한 자세로 돌아가 볼까요?',
}

/** Friendly copy for the status pill and side panel. */
export function statusCopy(view: LiveView) {
  const collapse = view.collapse ? COLLAPSE_TITLE[view.collapse] : '자세가 흐트러졌어요'
  switch (view.status) {
    case 'normal':
      return { pill: '바른 자세예요', title: '잘하고 있어요', tone: 'good' as const }
    case 'suspect':
      return { pill: '자세가 조금 달라졌어요', title: '잠깐 지켜보는 중이에요', tone: 'collapse' as const }
    case 'bad':
      return { pill: collapse, title: '자세를 살짝 고쳐볼까요?', tone: 'collapse' as const }
    case 'recovering':
      return { pill: '좋아요, 돌아오고 있어요', title: '조금만 그대로 있어 주세요', tone: 'good' as const }
    case 'unmeasurable':
      return { pill: '자세를 확인할 수 없어요', title: '화면 안으로 들어와 주세요', tone: 'unknown' as const }
    case 'analysisPaused':
      return { pill: '분석이 잠시 멈췄어요', title: '분석 연결을 기다리고 있어요', tone: 'unknown' as const }
    case 'paused':
      return { pill: '쉬는 중', title: '잠시 쉬고 있어요', tone: 'unknown' as const }
  }
}

export function correctionHint(view: LiveView) {
  return view.collapse ? COLLAPSE_HINT[view.collapse] : '편안하게 바로 앉아 볼까요?'
}

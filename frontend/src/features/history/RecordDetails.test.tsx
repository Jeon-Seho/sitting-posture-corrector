import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../../data/posture'
import type { RecordItem } from '../../lib/serviceStore'
import { serverRecordEvents } from '../storage/serverSnapshots'
import type { DecisionEvent } from '../session/server/contracts'
import { BASELINE_ID, SESSION_ID, view } from '../session/server/testFixtures'
import { RecordHistoryItem } from './RecordHistoryItem'
import { RecordDetails } from './RecordDetails'
import { ComparisonConditions } from './ComparisonConditions'
import { RecordComparison } from '../../components/RecordComparison'

// Every record and event below is synthetic; no camera data or participant information is used.
function localRecord(): RecordItem {
  return {
    id: 'synthetic-legacy-local',
    startedAt: '2026-09-01T01:00:00.000Z',
    endedAt: '2026-09-01T01:00:20.000Z',
    mode: 'camera',
    total: 20,
    valid: 9,
    good: 6,
    events: [],
  }
}

function decision(overrides: Partial<DecisionEvent>): DecisionEvent {
  return {
    schema_version: '1.0',
    session_id: SESSION_ID,
    event_id: 1,
    kind: 'collapse_confirmed',
    timestamp_ms: 4000,
    onset_ms: 1000,
    onset_valid_ms: 500,
    deviation_type: 'left_lean',
    reason: null,
    ...overrides,
  }
}

function serverRecord(confirmed = true): RecordItem {
  const base = view()
  const serverView = view({
    ended: confirmed,
    last_sequence: 4,
    summary: {
      ...base.summary,
      total_ms: 20000,
      valid_ms: 9000,
      normal_ms: 6000,
      deviation_ms: 3000,
      rest_ms: 2000,
      away_ms: 1000,
      unknown_ms: 3000,
      missing_ms: 5000,
      collapse_count: 2,
      alert_count: 3,
      keep_rate: 2 / 3,
      events_per_hour: 800,
    },
    events: [
      decision({}),
      decision({ event_id: 2, kind: 'reminder', timestamp_ms: 6000 }),
      decision({ event_id: 3, kind: 'interrupted', timestamp_ms: 7000, reason: 'rest' }),
      decision({
        event_id: 4,
        timestamp_ms: 15000,
        onset_ms: 12000,
        onset_valid_ms: 6000,
        deviation_type: 'right_lean',
      }),
      ...(confirmed
        ? [
            decision({
              event_id: 5,
              kind: 'interrupted',
              timestamp_ms: 20000,
              onset_ms: 12000,
              onset_valid_ms: 6000,
              deviation_type: 'right_lean',
              reason: 'ended',
            }),
            decision({
              event_id: 6,
              kind: 'session_ended',
              timestamp_ms: 20000,
              onset_ms: 20000,
              onset_valid_ms: 9000,
              deviation_type: 'none',
              reason: 'ended',
            }),
          ]
        : []),
    ],
  })
  return {
    ...localRecord(),
    id: SESSION_ID,
    rules: { ...DEFAULT_RULES },
    events: serverRecordEvents(serverView, confirmed),
    server: {
      baselineId: BASELINE_ID,
      modelVersion: 'reference-feature-rule-v1',
      confirmed,
      view: serverView,
    },
  }
}

describe('readable stored record details and comparison conditions', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.useRealTimers()
  })
  function renderRecord(record: RecordItem) {
    act(() => {
      renderer = create(
        <RecordDetails record={record} id="synthetic-details" titleId="synthetic-title" />,
      )
    })
    return JSON.stringify(renderer!.toJSON())
  }
  function fact(label: string) {
    const term = renderer!.root.findAllByType('dt').find((node) => node.children.join('') === label)
    if (!term) throw new Error(`Missing synthetic detail field: ${label}`)
    return term.parent!.findByType('dd').children.join('')
  }

  it('opens an accessible region from the record row and closes it again', () => {
    act(() => {
      renderer = create(<RecordHistoryItem record={localRecord()} />)
    })
    let button = renderer!.root.findByType('button')
    expect(button.props['aria-label']).toContain('기록 상세 보기')
    expect(button.props['aria-expanded']).toBe(false)
    expect(renderer!.root.findAllByType('section')).toHaveLength(0)
    act(() => button.props.onClick())
    button = renderer!.root.findByType('button')
    const section = renderer!.root.findByType('section')
    expect(button.props['aria-expanded']).toBe(true)
    expect(button.props['aria-controls']).toBe(section.props.id)
    expect(section.props['aria-labelledby']).toBe(renderer!.root.findByType('h4').props.id)
    expect(renderer!.root.findByType('h4').children).toEqual(['측정 기록 상세'])
    act(() => button.props.onClick())
    expect(renderer!.root.findAllByType('section')).toHaveLength(0)
  })

  it('keeps the server summary, all saved rules, mirrored directions and separate decision reasons', () => {
    const text = renderRecord(serverRecord())
    expect(text).toContain('서버 종료 확인')
    expect(text).toContain('왼쪽 기울어짐')
    expect(text).toContain('오른쪽 기울어짐')
    expect(text).toContain('미러 카메라 화면 기준')
    expect(text).toContain('같은 사건 재알림')
    expect(text).toContain('사건 중단')
    expect(text).toContain('세션 종료 확인')
    expect(text).toContain('이탈 확정')
    expect(text).toContain('복귀 확인') // Applied recovery setting, not a fabricated event.
    expect(text).toContain('변화 점수 기준 ≥ ')
    expect(fact('집계 제외 시간')).toBe('11초')
    expect(fact('휴식')).toBe('2초')
    expect(fact('자리 비움')).toBe('1초')
    expect(fact('측정 불가')).toBe('3초')
    expect(fact('관측 공백·누락')).toBe('5초')
    expect(fact('이탈 사건')).toBe('2건')
    expect(fact('알림')).toBe('3회')
    expect(text).toContain(BASELINE_ID)
    expect(text).toContain('reference-feature-rule-v1')
  })

  it('preserves a still-open server episode instead of fabricating recovery or end after archive', () => {
    const record = serverRecord(false)
    const before = structuredClone(record)
    const text = renderRecord(record)
    expect(text).toContain('서버 종료 미확인')
    expect(text).toContain('마지막 서버 확인 시 이탈 사건이 계속 중이었습니다')
    expect(text).toContain('요약 보관 시각')
    const rows = renderer!.root.findAllByType('tbody')[0].findAllByType('tr')
    expect(rows).toHaveLength(4)
    expect(
      rows
        .flatMap((row) => row.findAllByType('td'))
        .some((cell) => cell.children.join('') === '세션 종료 확인'),
    ).toBe(false)
    expect(record).toEqual(before)
    expect(record.server!.view!.ended).toBe(false)
    expect(
      record.server!.view!.events.some(
        (event) => event.kind === 'recovery_confirmed' || event.kind === 'session_ended',
      ),
    ).toBe(false)
  })

  it('reports zero valid time as unavailable and keeps subsecond excluded time visible', () => {
    const record = serverRecord()
    record.total = 0.25
    record.valid = 0
    record.good = 0
    record.events = []
    const empty = view({ ended: true })
    empty.summary.total_ms = 250
    empty.summary.unknown_ms = 250
    record.server!.view = empty
    const text = renderRecord(record)
    expect(fact('기준 자세 유지율')).toBe('계산 불가')
    expect(fact('시간당 이탈 사건')).toBe('계산 불가')
    expect(fact('평균 회복 시간')).toBe('계산 불가')
    expect(fact('측정 불가')).toBe('0.25초')
    expect(text).toContain('서버에 확인된 사건이 없습니다')
  })

  it('shows absent local baseline, model, settings and excluded breakdown without current defaults', () => {
    const text = renderRecord(localRecord())
    expect(text).toContain('기준 ID가 기록에 없음')
    expect(text).toContain('모델 버전이 기록에 없음')
    expect(text).toContain('기록에 적용 설정이 남아 있지 않습니다')
    expect(text).toContain('구분할 수 없습니다')
    expect(fact('집계 제외 시간')).toBe('11초')
    expect(
      renderer!.root.findAllByType('dt').some((node) => node.children.join('') === '휴식'),
    ).toBe(false)
    expect(text).not.toContain('변화 점수 기준 ≥')
  })

  it('keeps interrupted local episodes distinct from recovery', () => {
    const record = localRecord()
    record.events = [
      {
        id: 1,
        type: 'referenceChange',
        startAt: 1,
        confirmedAt: 4,
        endAt: 7,
        durationSec: 6,
        alerts: 1,
        firstAlertAt: 4,
        recovered: false,
        recoverySec: null,
        endedBySession: false,
        endReason: 'paused',
        blockId: 0,
      },
    ]
    const text = renderRecord(record)
    expect(text).toContain('휴식으로 중단')
    expect(fact('평균 회복 시간')).toBe('계산 불가')
    expect(record.events[0].recovered).toBe(false)
  })

  it('clearly identifies a server record with no confirmed detail response', () => {
    const record = serverRecord(false)
    record.total = 0
    record.valid = 0
    record.good = 0
    record.events = []
    record.server!.view = null
    record.server!.modelVersion = 'unmeasured'
    const text = renderRecord(record)
    expect(text).toContain('실제 웹캠 · 서버 판정')
    expect(text).toContain('서버 상세 응답이 기록에 없습니다')
    expect(fact('모델 버전')).toBe('확인할 수 없음 · 서버 상세 응답 없음')
    expect(fact('기준 자세 유지율')).toBe('계산 불가')
  })

  it('displays all condition differences without claiming matching conditions or changing statistics', () => {
    const early = localRecord()
    early.rules = { ...DEFAULT_RULES, recoverSeconds: 2, threshold: 0.731 }
    const recent = serverRecord(false)
    recent.rules = { ...DEFAULT_RULES, recoverSeconds: 4, threshold: 0.732 }
    act(() => {
      renderer = create(<ComparisonConditions early={[early]} recent={[recent]} />)
    })
    const text = JSON.stringify(renderer!.toJSON())
    expect(renderer!.root.findByType('section').props['aria-label']).toBe('기록 비교 조건')
    expect(text).toContain('판정 출처가 섞여 있습니다')
    expect(text).toContain('적용 설정이 다릅니다')
    expect(text).toContain('수치 변화가 자세 개선을 뜻하지 않을 수 있습니다')
    expect(text).toContain('기준 ID가 기록에 없음')
    expect(text).toContain('서버 종료를 확인하지 못한 기록')
    expect(text).toContain('0.731')
    expect(text).toContain('0.732')
    expect(
      renderer!.root
        .findAllByType('ul')
        .filter((node) => node.props.className === 'history-rule-list'),
    ).toHaveLength(2)
    expect(early.valid).toBe(9)
    expect(recent.valid).toBe(9)
  })

  it('does not present comparison conditions before the two date windows are separate', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T03:00:00.000Z'))
    const recentOnly = { ...localRecord(), endedAt: '2026-09-28T01:00:20.000Z' }
    act(() => {
      renderer = create(<RecordComparison records={[recentOnly]} />)
    })
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('지나야 비교할 수 있습니다')
    expect(renderer!.root.findAllByProps({ 'aria-label': '기록 비교 조건' })).toHaveLength(0)
    expect(renderer!.root.findAllByType('table')).toHaveLength(0)
  })

  it('shows the condition disclosure with the insufficient-time caveat when comparison is short', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T03:00:00.000Z'))
    const recent = { ...serverRecord(), endedAt: '2026-09-28T01:00:20.000Z' }
    act(() => {
      renderer = create(<RecordComparison records={[localRecord(), recent]} />)
    })
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('미만이라 변화는 참고용입니다')
    expect(text).toContain('판정 출처가 섞여 있습니다')
    expect(renderer!.root.findAllByProps({ 'aria-label': '기록 비교 조건' })).toHaveLength(1)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { DEFAULT_RULES } from '../data/posture'
import { newMachine, sampleAt, type Machine, type SessionPhase } from '../lib/engine'
import { useSession } from './useSession'

describe('session lifecycle with synthetic input', () => {
  let renderer: ReactTestRenderer | undefined
  let latest: ReturnType<typeof useSession>
  const source = () => ({ ...sampleAt(0), state: 'collapse' as const, prob: .9, collapse: 'tilt' as const })
  const ended = vi.fn(), checkpoint = vi.fn(), interrupted = vi.fn()
  function Probe({ phase, initial }: { phase: SessionPhase; initial?: Machine }) {
    latest = useSession(phase, 1, DEFAULT_RULES, source, true, { initial, ended, checkpoint, interrupted })
    return null
  }
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    ended.mockClear(); checkpoint.mockClear(); interrupted.mockClear()
  })
  afterEach(() => {
    act(() => renderer?.unmount()); renderer = undefined
    vi.useRealTimers(); vi.restoreAllMocks()
  })
  it('shows recovered totals immediately and ends a recovered paused session without erasing them', () => {
    const initial = newMachine(); initial.total = 200; initial.good = 100; initial.paused = 50; initial.unknown = 50
    act(() => { renderer = create(<Probe phase="paused" initial={initial}/>) })
    expect(latest.live.totalSeconds).toBe(200); expect(latest.live.validSeconds).toBe(100)
    act(() => renderer!.update(<Probe phase="ended" initial={initial}/>))
    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended.mock.calls[0][0]).toMatchObject({ totalSeconds: 200, goodSeconds: 100, validSeconds: 100 })
    expect(initial.interrupted).toBe(false)
  })
  it('saves a closed final event exactly once before any further timer ticks', () => {
    act(() => { renderer = create(<Probe phase="running"/>) })
    act(() => { vi.advanceTimersByTime(4000) })
    expect(latest.live.events).toHaveLength(1)
    act(() => renderer!.update(<Probe phase="ended"/>))
    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended.mock.calls[0][0].events[0]).toMatchObject({ endReason: 'ended', endedBySession: true })
    expect(ended.mock.calls[0][0].events[0].endAt).not.toBeNull()
    const total = latest.live.totalSeconds
    act(() => { vi.advanceTimersByTime(1000) }); expect(latest.live.totalSeconds).toBe(total)
  })
  it('excludes a scheduling gap, interrupts confirmation and requests manual resumption', () => {
    act(() => { renderer = create(<Probe phase="running"/>) })
    act(() => { vi.advanceTimersByTime(2000) })
    const before = latest.live.validSeconds
    vi.setSystemTime(6000)
    act(() => { vi.advanceTimersByTime(50) })
    expect(interrupted).toHaveBeenCalledTimes(1)
    expect(latest.live.validSeconds).toBeCloseTo(before)
    expect(latest.live.unknownSeconds).toBeGreaterThan(4)
    expect(latest.live.events).toHaveLength(0)
  })
  it('checkpoints and interrupts an open event on component disposal', () => {
    act(() => { renderer = create(<Probe phase="running"/>) })
    act(() => { vi.advanceTimersByTime(4000) })
    act(() => renderer!.unmount()); renderer = undefined
    const saved = checkpoint.mock.calls.at(-1)![0] as Machine
    expect(saved.active).toBeNull(); expect(saved.events[0].endReason).toBe('paused')
  })
})

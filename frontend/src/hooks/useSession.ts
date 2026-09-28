import { useEffect, useRef, useState } from 'react'
import { DEFAULT_RULES } from '../data/posture'
import { EMPTY_LIVE, closeOpenEvent, newMachine, sampleAt, seekNextSegment, snapshot, step,
  type LiveState, type Machine, type Rules, type Sample, type SessionPhase } from '../lib/engine'

export type { CollapseEvent, LiveState, SessionPhase } from '../lib/engine'

/** Demo and real camera share the same timing and event policies. */
export function useSession(phase: SessionPhase, speed: number, rules: Rules = DEFAULT_RULES,
  source?: () => Sample, alertsOn = true, lifecycle?: { initial?: Machine; checkpoint?: (machine: Machine) => void; interrupted?: () => void }) {
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE)
  const m = useRef<Machine>(lifecycle?.initial ?? newMachine())
  const checkpointAt = useRef(0)
  const lifecycleRef = useRef(lifecycle); lifecycleRef.current = lifecycle
  const lastSample = useRef<Sample>(sampleAt(0))
  const input = useRef({ phase, speed, rules, source, alertsOn })
  input.current = { phase, speed, rules, source, alertsOn }
  const lastTs = useRef<number | null>(null)

  useEffect(() => {
    if (phase === 'ended') closeOpenEvent(m.current)
    else if (phase === 'paused') step(m.current, 0, phase, rules, source?.(), false)
    setLive(snapshot(m.current, lastSample.current, rules))
    lifecycleRef.current?.checkpoint?.(structuredClone(m.current))
  }, [phase])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = (ts: number) => {
      timer = setTimeout(() => tick(performance.now()), 50)
      const current = input.current
      const dt = lastTs.current === null ? 0 : Math.max(0, (ts - lastTs.current) / 1000)
      if (dt < 0.05 && lastTs.current !== null) return
      lastTs.current = ts
      if (current.phase === 'ended') return
      let s: Sample
      if (dt > 1.5 && current.phase === 'running') {
        lifecycleRef.current?.interrupted?.()
        // A background/scheduling gap is not a valid observation interval.
        s = step(m.current, dt, 'running', current.rules,
          { ...lastSample.current, state: 'unknown', notice: '입력이 잠시 중단되었습니다.', prob: 0, confidence: 0 }, false)
      } else {
        s = step(m.current, dt * (current.source ? 1 : current.speed), current.phase,
          current.rules, current.source?.(), current.alertsOn)
      }
      lastSample.current = s
      setLive(snapshot(m.current, s, current.rules))
      if (ts - checkpointAt.current > 2000) { checkpointAt.current = ts; lifecycleRef.current?.checkpoint?.(structuredClone(m.current)) }
    }
    timer = setTimeout(() => tick(performance.now()), 50)
    return () => clearTimeout(timer)
  }, [])

  const reset = () => { m.current = newMachine(); lastTs.current = null; lastSample.current = sampleAt(0); setLive(EMPTY_LIVE) }
  return { live, reset, seekNext: () => { if (!input.current.source) seekNextSegment(m.current) } }
}

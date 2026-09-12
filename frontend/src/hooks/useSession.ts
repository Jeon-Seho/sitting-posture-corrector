import { useEffect, useRef, useState } from 'react'
import { DEFAULT_RULES } from '../data/posture'
import {
  EMPTY_LIVE,
  closeOpenEvent,
  newMachine,
  sampleAt,
  seekNextSegment,
  snapshot,
  step,
  type LiveState,
  type Machine,
  type Rules,
  type SessionPhase,
} from '../lib/engine'

export type { CollapseEvent, LiveState, SessionPhase } from '../lib/engine'

const UI_INTERVAL = 1000 / 30

/**
 * 가짜 웹캠 세션. 카메라도 모델도 없이 시나리오를 반복 재생하면서
 * engine의 판정 규칙을 실시간으로 돌린다.
 */
export function useSession(phase: SessionPhase, speed: number, rules: Rules = DEFAULT_RULES) {
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE)
  const m = useRef<Machine>(newMachine())
  const raf = useRef(0)
  const lastTs = useRef(0)
  const lastUi = useRef(0)
  const phaseRef = useRef(phase)

  useEffect(() => {
    if (phase === 'ended' && phaseRef.current !== 'ended') {
      closeOpenEvent(m.current)
      setLive(snapshot(m.current, sampleAt(m.current.loop), rules))
    }
    phaseRef.current = phase
  }, [phase, rules])

  useEffect(() => {
    if (phase === 'ended') {
      lastTs.current = 0
      return
    }

    const tick = (ts: number) => {
      raf.current = requestAnimationFrame(tick)
      const real = lastTs.current ? Math.min((ts - lastTs.current) / 1000, 0.25) : 0
      lastTs.current = ts

      const sample = step(m.current, real * speed, phase, rules)

      if (ts - lastUi.current >= UI_INTERVAL) {
        lastUi.current = ts
        setLive(snapshot(m.current, sample, rules))
      }
    }

    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [phase, speed, rules])

  const seekNext = () => {
    seekNextSegment(m.current)
  }

  const reset = () => {
    m.current = newMachine()
    lastTs.current = 0
    lastUi.current = 0
    setLive(EMPTY_LIVE)
  }

  return { live, reset, seekNext }
}

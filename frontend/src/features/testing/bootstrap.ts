import { KEYS } from '../storage/types'
import { advanceClock, installClock } from './syntheticClock'
import { emitSyntheticFrame, syntheticCameraStatus } from './useSyntheticCamera'
import { requireSyntheticMode } from './guard'
import { legacySyntheticRecord } from './legacySyntheticRecord'
import { syntheticObservation, type SyntheticKind } from './syntheticPose'

requireSyntheticMode()

type HeldResponse = {
  kind: string
  ready: boolean
  release: () => void
}

type Trace = {
  path: string
  method: string
  body: unknown
  status?: number
}

export function installSyntheticBrowser() {
  requireSyntheticMode()
  installClock()
  if (!localStorage.getItem(KEYS.profile)) {
    localStorage.setItem(
      KEYS.profile,
      JSON.stringify({
        name: '합성 브라우저 회귀',
        age: 23,
        occupation: '명시적 합성 테스트'
      })
    )
  }
  let permissionCalls = 0
  // A regression attempting actual capture fails before a browser permission prompt opens.
  navigator.mediaDevices.getUserMedia = async () => {
    permissionCalls++
    throw new Error('Actual camera capture is forbidden in the synthetic browser regression.')
  }
  const trace: Trace[] = []
  let nextHold: string | null = null
  let held: HeldResponse | null = null
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const path = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      location.href
    ).pathname
    const entry: Trace = {
      path,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
    }
    if (path.startsWith('/api/')) trace.push(entry)
    const hold = nextHold && path.endsWith('/' + nextHold)
    if (hold) nextHold = null
    const response = await realFetch(input, init)
    entry.status = response.status
    if (hold) {
      await new Promise<void>((release) => {
        held = {
          kind: path.split('/').at(-1)!,
          ready: true,
          release
        }
      })
      held = null
    }
    return response
  }
  const bridge = {
    forecastFrame(milliseconds: number, displacement = 0, poor = false) {
      advanceClock(milliseconds)
      const image = Array.from({ length: 13 }, () => ({ x: .5, y: .5, z: 0, visibility: poor ? .1 : .95 }))
      const world = image.map((p, i) => ({ ...p, x: i === 11 ? -.2 : i === 12 ? .2 : 0,
        y: i < 11 ? -.3 + displacement : 0, z: 0 }))
      emitSyntheticFrame(!poor, {
        timeMs: performance.now(), videoTimeMs: performance.now(), landmarks: image, worldLandmarks: world,
        measurable: !poor, width: 640, height: 480, inferenceMs: 1, delegate: 'CPU',
      })
    },
    frame(milliseconds: number, kind: SyntheticKind = 'deviation') {
      advanceClock(milliseconds)
      // The app computes no posture values; the server judges the coordinates (ADR 0021).
      const frame = syntheticObservation(kind, performance.now())
      emitSyntheticFrame(frame.measurable, frame)
    },
    advance: advanceClock,
    holdNext(kind: 'features' | 'end') {
      if (held || nextHold) throw new Error('A response is already held.')
      nextHold = kind
    },
    release() {
      held?.release()
    },
    appendLegacyFixture() {
      const records = JSON.parse(localStorage.getItem(KEYS.records) ?? '[]')
      records.push(legacySyntheticRecord())
      localStorage.setItem(KEYS.records, JSON.stringify(records))
    },
    snapshot() {
      return {
        now: performance.now(),
        permissionCalls,
        camera: syntheticCameraStatus(),
        held: held && {
          kind: held.kind,
          ready: held.ready
        },
        trace,
        records: JSON.parse(localStorage.getItem(KEYS.records) ?? '[]')
      }
    },
  }
  Object.defineProperty(window, '__POSEGOOD_SYNTHETIC_BROWSER_ONLY__', { value: bridge })
  const badge = document.createElement('aside')
  badge.textContent = '명시적 합성 브라우저 검증 · 실제 카메라 미사용'
  badge.style.cssText = 'position:fixed;bottom:0;left:0;z-index:9999;background:#fff;color:#111;padding:4px;font-size:12px'
  document.body.append(badge)
}

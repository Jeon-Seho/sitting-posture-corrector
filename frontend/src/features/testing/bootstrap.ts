import { KEYS } from '../storage/types'
import { advanceClock, installClock } from './syntheticClock'
import { emitSyntheticFrame, syntheticCameraStatus, SYNTHETIC_BASELINE } from './useSyntheticCamera'
import { requireSyntheticMode } from './guard'
import { legacySyntheticRecord } from './legacySyntheticRecord'

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
    frame(milliseconds: number, kind: 'normal' | 'deviation' | 'poor' = 'deviation') {
      advanceClock(milliseconds)
      emitSyntheticFrame(kind === 'poor' ? null : kind === 'normal' ? { ...SYNTHETIC_BASELINE } : {
        ...SYNTHETIC_BASELINE,
        headGap: 1.14
      })
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
        draft: JSON.parse(localStorage.getItem(KEYS.draft) ?? 'null'),
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

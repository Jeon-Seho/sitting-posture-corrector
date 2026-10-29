import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { TRACKING_FPS_CHOICES } from '../../lib/skeleton'
import { recommendRate, stillNoise, type RateResult } from './trackingRate'
import type { Landmark } from '../../../../model/prototype/pose'
import { SelectMenu } from '../../components/SelectMenu'

type Camera = Pick<
  CameraController,
  'state' | 'quality' | 'subscribe' | 'trackingFps' | 'setTrackingFps' | 'tryTrackingFps'
>

const SETTLE_MS = 800
const MEASURE_MS = 3000

/**
 * 추적 속도 and its jitter check (2026-10-13). Sitting still, each rate runs for about 3 s;
 * the shake of the nose and shoulders (in shoulder widths) and the real rate are compared,
 * and the steadiest rate is suggested. Only the display and local judging use the cap;
 * nothing is sent anywhere.
 */
export function TrackingRateCheck({ camera }: { camera: Camera }) {
  const [running, setRunning] = useState<number | null>(null)
  const [results, setResults] = useState<RateResult[] | null>(null)
  const [message, setMessage] = useState('')
  const cancelled = useRef(false)
  const latest = useRef(camera)
  latest.current = camera
  useEffect(
    () => () => {
      cancelled.current = true
      latest.current.tryTrackingFps(null)
    },
    [],
  )

  async function run() {
    if (camera.state !== 'on' || !camera.quality) {
      setMessage('카메라를 켜고 얼굴과 양쪽 어깨가 보이게 앉은 뒤 다시 눌러 주세요.')
      return
    }
    cancelled.current = false
    setMessage('')
    setResults(null)
    const out: RateResult[] = []
    for (const fps of TRACKING_FPS_CHOICES) {
      if (cancelled.current) break
      setRunning(fps)
      latest.current.tryTrackingFps(fps)
      await wait(SETTLE_MS)
      const frames: Landmark[][] = []
      let size = { width: 0, height: 0 }
      let inference = 0
      const stop = latest.current.subscribe((o) => {
        if (o.landmarks.length) frames.push(o.landmarks)
        size = { width: o.width, height: o.height }
        inference += o.inferenceMs
      })
      await wait(MEASURE_MS)
      stop()
      out.push({
        fps,
        measuredFps: frames.length / (MEASURE_MS / 1000),
        inferenceMs: frames.length ? inference / frames.length : 0,
        noise: stillNoise(frames, size.width, size.height),
      })
      setResults([...out])
    }
    latest.current.tryTrackingFps(null)
    setRunning(null)
    if (!cancelled.current && recommendRate(out) === null)
      setMessage('사람이 충분히 보이지 않아 비교하지 못했어요. 화면 가운데에 가만히 앉아 다시 해 주세요.')
  }

  const recommended = results && running === null ? recommendRate(results) : null
  return (
    <div className="rate-check">
      <div className="setting-control">
        <SelectMenu
          label="추적 속도"
          value={String(camera.trackingFps ?? '')}
          disabled={running !== null}
          onChange={(v) => camera.setTrackingFps(v ? Number(v) : null)}
          options={[
            { value: '', label: '자동 (최대 30)' },
            ...TRACKING_FPS_CHOICES.map((fps) => ({ value: String(fps), label: `초당 ${fps}회` })),
          ]}
        />
        <button className="chip" disabled={running !== null} onClick={() => void run()}>
          {running === null ? '떨림 점검 (약 16초)' : `초당 ${running}회 점검 중…`}
        </button>
      </div>
      {running !== null && <p className="fine" role="status">가만히 앉아 화면을 봐 주세요.</p>}
      {message && <p className="fine" role="alert">{message}</p>}
      {results && (
        <div className="rate-results"><table className="rate-table">
          <thead>
            <tr>
              <th>설정</th>
              <th className="t-right">실제 속도</th>
              <th className="t-right">처리 시간</th>
              <th className="t-right">떨림</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.fps} className={r.fps === recommended ? 'is-best' : ''}>
                <td>초당 {r.fps}회{r.fps === recommended ? ' · 추천' : ''}</td>
                <td className="t-right num">{r.measuredFps.toFixed(1)}회</td>
                <td className="t-right num">{r.inferenceMs.toFixed(0)}ms</td>
                <td className="t-right num">{r.noise === null ? '—' : `${(r.noise * 100).toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {recommended !== null && recommended !== camera.trackingFps && (
        <button className="btn btn-sm btn-primary" onClick={() => camera.setTrackingFps(recommended)}>
          초당 {recommended}회로 적용
        </button>
      )}
    </div>
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
